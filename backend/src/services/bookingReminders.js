// Booking reminders sweep — sends the 24h-before and 1h-before WhatsApp
// reminders for confirmed bookings, then marks each as processed so it fires
// exactly once. Driven by index.js (setInterval on Docker) and the
// /api/cron/booking-reminders endpoint (Vercel). Idempotent and restart-safe:
// dedup lives in booking_events, not in memory.
//
// Reminders are TRANSACTIONAL and time-critical, so — unlike the marketing
// follow-up worker — they do NOT observe quiet hours (a 1h reminder at 08:00 for
// a 09:00 call must still go out).

const pool = require('../db');
const { notifyBookingReminder, notifyBookingRecovery } = require('./bookingNotifications');
const { decryptContacts } = require('./bookingCrypto');

// Each window: the marker event type (dedup key) and the time predicate.
//   24h — booking is within the next 24h but more than 1h away (the day-before
//         nudge; also covers same-day bookings made >1h ahead).
//   1h  — booking is within the final hour.
const WINDOWS = [
  { kind: '24h', cond: "b.starts_at <= NOW() + INTERVAL '24 hours' AND b.starts_at > NOW() + INTERVAL '1 hour'" },
  { kind: '1h',  cond: "b.starts_at <= NOW() + INTERVAL '1 hour'  AND b.starts_at > NOW()" },
];
const MAX_PER_RUN = 200;

async function sweepWindow({ kind, cond }) {
  const markerType = `booking.reminder_${kind}`;
  const { rows } = await pool.query(
    `SELECT b.*, s.name AS service_name, c.display_name AS consultant_name
       FROM coexistence.bookings b
       JOIN coexistence.booking_services s    ON s.id = b.service_id
       JOIN coexistence.booking_consultants c ON c.id = b.consultant_id
      WHERE b.status = 'confirmed'
        AND ${cond}
        AND NOT EXISTS (
          SELECT 1 FROM coexistence.booking_events e
           WHERE e.booking_id = b.id AND e.type = $1
        )
      ORDER BY b.starts_at ASC
      LIMIT ${MAX_PER_RUN}`,
    [markerType]
  );

  let processed = 0;
  for (const b of rows) {
    try {
      await notifyBookingReminder({
        booking: decryptContacts(b), // visitor_phone is encrypted at rest
        service: { name: b.service_name },
        consultant: { display_name: b.consultant_name },
        kind,
      });
    } catch (err) {
      console.error(`[booking-reminders] ${kind} send failed for booking ${b.id}: ${err.message}`);
    }
    // Mark as processed regardless of send outcome so a booking with no phone /
    // an unapproved template isn't retried every tick. notifyBookingReminder
    // already logs the detailed sent/skipped/failed event.
    try {
      await pool.query(
        `INSERT INTO coexistence.booking_events (booking_id, type, actor_type, payload)
         VALUES ($1, $2, 'system', $3)`,
        [b.id, markerType, { kind }]
      );
    } catch (err) {
      console.error(`[booking-reminders] marker insert failed for booking ${b.id}: ${err.message}`);
    }
    processed++;
  }
  return processed;
}

async function runBookingReminders() {
  const result = {};
  for (const w of WINDOWS) {
    try { result[w.kind] = await sweepWindow(w); }
    catch (err) { console.error(`[booking-reminders] ${w.kind} sweep error: ${err.message}`); result[w.kind] = 0; }
  }
  const total = Object.values(result).reduce((a, n) => a + n, 0);
  if (total > 0) console.log(`[booking-reminders] processed 24h=${result['24h']} 1h=${result['1h']}`);
  return result;
}

// No-show recovery: a confirmed booking whose end time passed (plus a grace
// period) but that was never marked completed / no-show. We can't detect
// attendance, so this sends a gentle "did we miss you?" re-book nudge, once.
// A 7-day lookback stops the very first run from blasting a backlog of old
// bookings. Grace period configurable via BOOKING_NOSHOW_GRACE_MIN (default 120).
async function runNoShowRecovery() {
  const markerType = 'booking.no_show_followup';
  const graceMin = parseInt(process.env.BOOKING_NOSHOW_GRACE_MIN || '', 10) || 120;
  const { rows } = await pool.query(
    `SELECT b.*, s.name AS service_name, c.display_name AS consultant_name
       FROM coexistence.bookings b
       JOIN coexistence.booking_services s    ON s.id = b.service_id
       JOIN coexistence.booking_consultants c ON c.id = b.consultant_id
      WHERE b.status = 'confirmed'
        AND b.ends_at < NOW() - ($1 || ' minutes')::interval
        AND b.ends_at > NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM coexistence.booking_events e
           WHERE e.booking_id = b.id AND e.type = $2
        )
      ORDER BY b.ends_at ASC
      LIMIT ${MAX_PER_RUN}`,
    [String(graceMin), markerType]
  );

  let processed = 0;
  for (const b of rows) {
    try {
      await notifyBookingRecovery({
        booking: decryptContacts(b),
        service: { name: b.service_name },
        consultant: { display_name: b.consultant_name },
      });
    } catch (err) {
      console.error(`[no-show-recovery] send failed for booking ${b.id}: ${err.message}`);
    }
    try {
      await pool.query(
        `INSERT INTO coexistence.booking_events (booking_id, type, actor_type, payload)
         VALUES ($1, $2, 'system', $3)`,
        [b.id, markerType, { graceMin }]
      );
    } catch (err) {
      console.error(`[no-show-recovery] marker insert failed for booking ${b.id}: ${err.message}`);
    }
    processed++;
  }
  if (processed > 0) console.log(`[no-show-recovery] processed ${processed}`);
  return processed;
}

// Single entry point for the scheduler / cron: reminders + no-show recovery.
async function runBookingSweeps() {
  const reminders = await runBookingReminders();
  let noShow = 0;
  try { noShow = await runNoShowRecovery(); }
  catch (err) { console.error('[no-show-recovery] sweep error:', err.message); }
  return { ...reminders, noShow };
}

module.exports = { runBookingReminders, runNoShowRecovery, runBookingSweeps };
