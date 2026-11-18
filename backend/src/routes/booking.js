// Calendar Booking module — API (Phase 1 MVP).
//
// Two routers:
//   * router       — authenticated dashboard API (admin-only mutations): manage
//                    services, consultants, eligibility, and view/act on bookings.
//   * publicRouter — UNauthenticated public booking flow used by the booking page:
//                    page config -> availability -> hold -> confirm -> cancel.
//                    Mounted BEFORE authMiddleware in app.js.
//
// Assignment (single / round-robin), Google free/busy conflict checks and the
// Google Meet event are handled via services/googleCalendar (mock by default)
// and services/bookingAvailability. A slot is never promised before a
// short-lived DB hold succeeds, and confirmation re-checks availability under an
// advisory lock so two visitors can't double-book the same consultant.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const pool = require('../db');
const { adminOnly, auditLog, effectiveWaNumbers } = require('../middleware/access');
const { isAdmin } = require('../permissions');
const { consultantSlotStarts } = require('../services/bookingAvailability');
const gcal = require('../services/googleCalendar');
const bookingNotify = require('../services/bookingNotifications');
const { encrypt, decryptContacts } = require('../services/bookingCrypto');
const googleAuth = require('../services/googleAuth');
const payments = require('../services/paymentProvider');

const HOLD_TTL_MINUTES = 10;
const MAX_RANGE_DAYS = 31; // cap availability windows to keep queries bounded

/* --------------------------------- shapes -------------------------------- */
function serviceShape(r, consultants = []) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    durationMinutes: r.duration_minutes,
    bufferBeforeMinutes: r.buffer_before_minutes,
    bufferAfterMinutes: r.buffer_after_minutes,
    minimumNoticeMinutes: r.minimum_notice_minutes,
    bookingHorizonDays: r.booking_horizon_days,
    slotGranularityMinutes: r.slot_granularity_minutes,
    assignmentPolicy: r.assignment_policy,
    meetingMode: r.meeting_mode,
    active: r.active,
    waNumber: r.wa_number || null,   // owning office (WhatsApp number); null = global
    paymentPolicy: r.payment_policy || 'free',
    priceMinor: r.price_minor || 0,
    depositMinor: r.deposit_minor || 0,
    currency: r.currency || 'INR',
    consultants,
  };
}
function consultantShape(r) {
  return {
    id: r.id,
    displayName: r.display_name,
    email: r.email,
    googleCredentialId: r.google_credential_id,
    calendarId: r.calendar_id,
    timeZone: r.time_zone,
    workingHours: r.working_hours,
    active: r.active,
    calendarConnected: !!r.google_credential_id,
    userId: r.user_id || null,   // the login this consultant is (chats with their customers)
    commissionType: r.commission_type || 'none',
    commissionFixedMinor: r.commission_fixed_minor || 0,
    commissionBps: r.commission_bps || 0,
  };
}
function bookingShape(row) {
  const r = decryptContacts(row); // visitor_email/phone/notes are encrypted at rest
  return {
    id: r.id,
    serviceId: r.service_id,
    serviceName: r.service_name,
    consultantId: r.consultant_id,
    consultantName: r.consultant_name,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    timeZone: r.time_zone,
    visitorName: r.visitor_name,
    visitorEmail: r.visitor_email,
    visitorPhone: r.visitor_phone,
    notes: r.notes,
    meetingUrl: r.meeting_url,
    assignmentReason: r.assignment_reason,
    paymentStatus: r.payment_status || 'not_required',
    amountMinor: r.amount_minor || 0,
    currency: r.currency || 'INR',
    createdAt: r.created_at,
  };
}

/* ------------------------------- data helpers ----------------------------- */
async function loadServiceBySlug(slug) {
  const { rows } = await pool.query('SELECT * FROM coexistence.booking_services WHERE slug = $1', [slug]);
  return rows[0] || null;
}
async function loadEligibleConsultants(serviceId) {
  const { rows } = await pool.query(
    `SELECT c.*, sc.priority
       FROM coexistence.booking_service_consultants sc
       JOIN coexistence.booking_consultants c ON c.id = sc.consultant_id
      WHERE sc.service_id = $1 AND c.active = TRUE
      ORDER BY sc.priority ASC, c.id ASC`,
    [serviceId]
  );
  return rows;
}
// Internal (our DB) busy intervals for a consultant in [from,to): confirmed
// bookings + active, non-expired holds. Optionally ignore one hold (the one being
// confirmed).
async function internalBusy(consultantId, from, to, ignoreHoldId = null) {
  const { rows: bk } = await pool.query(
    `SELECT starts_at AS start, ends_at AS end FROM coexistence.bookings
      WHERE consultant_id = $1 AND status = 'confirmed'
        AND starts_at < $3 AND ends_at > $2`,
    [consultantId, from, to]
  );
  const { rows: hd } = await pool.query(
    `SELECT starts_at AS start, ends_at AS end FROM coexistence.booking_holds
      WHERE consultant_id = $1 AND status = 'active' AND expires_at > NOW()
        AND ($4::bigint IS NULL OR id <> $4)
        AND starts_at < $3 AND ends_at > $2`,
    [consultantId, from, to, ignoreHoldId]
  );
  return [...bk, ...hd];
}
// Full busy set = internal + external (Google, mock => []).
async function busyFor(consultant, from, to, ignoreHoldId = null) {
  const internal = await internalBusy(consultant.id, from, to, ignoreHoldId);
  let external = [];
  try {
    external = await gcal.getBusyIntervals({ consultant, from, to });
  } catch (err) {
    // If a real calendar can't be read we exclude this consultant rather than
    // risk a double-book. Signal via throw so callers skip them.
    const e = new Error('calendar_unavailable');
    e.consultantId = consultant.id;
    throw e;
  }
  return [...internal, ...external];
}

/* ============================ PUBLIC BOOKING API ========================== */
const publicRouter = Router();

// Tighter per-IP limit for state-changing public actions (holds/confirms/
// reschedules/cancels) — anti-abuse on top of the app-wide limiter. Reads
// (page config + availability) stay under the global limiter only.
const bookingWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' }),
});

// Page config for the booking widget. No consultant identity/PII leaked.
publicRouter.get('/public/booking/:slug', async (req, res) => {
  try {
    const service = await loadServiceBySlug(req.params.slug);
    if (!service || !service.active) return res.status(404).json({ error: 'Booking page not found' });
    const consultants = await loadEligibleConsultants(service.id);
    if (consultants.length === 0) return res.status(409).json({ error: 'This service has no available consultants yet.' });
    res.json({
      name: service.name,
      slug: service.slug,
      description: service.description,
      durationMinutes: service.duration_minutes,
      timeZone: consultants[0].time_zone, // display zone hint
      bookingHorizonDays: service.booking_horizon_days,
      paymentPolicy: service.payment_policy || 'free',
      priceMinor: service.price_minor || 0,
      depositMinor: service.deposit_minor || 0,
      currency: service.currency || 'INR',
    });
  } catch (err) {
    console.error('[booking] public page error:', err.message);
    res.status(500).json({ error: 'Failed to load booking page' });
  }
});

// Available slot starts (ISO, UTC) between ?from&to. A slot is offered if at
// least one eligible consultant is free.
publicRouter.get('/public/booking/:slug/availability', async (req, res) => {
  try {
    const service = await loadServiceBySlug(req.params.slug);
    if (!service || !service.active) return res.status(404).json({ error: 'Booking page not found' });
    const consultants = await loadEligibleConsultants(service.id);
    if (consultants.length === 0) return res.json({ slots: [], durationMinutes: service.duration_minutes });

    const now = Date.now();
    const from = req.query.from ? new Date(req.query.from) : new Date(now);
    let to = req.query.to ? new Date(req.query.to) : new Date(now + 14 * 86400000);
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Invalid from/to' });
    if (to - from > MAX_RANGE_DAYS * 86400000) to = new Date(from.getTime() + MAX_RANGE_DAYS * 86400000);

    const offered = new Set();
    for (const c of consultants) {
      let busy;
      try { busy = await busyFor(c, from, to); }
      catch { continue; } // skip a consultant whose calendar can't be read
      for (const ms of consultantSlotStarts({ service, consultant: c, from, to, busy, now })) {
        offered.add(ms);
      }
    }
    const slots = Array.from(offered).sort((a, b) => a - b).map(ms => new Date(ms).toISOString());
    res.json({ slots, durationMinutes: service.duration_minutes });
  } catch (err) {
    console.error('[booking] availability error:', err.message);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// Pick a free consultant for an exact slot per the service's policy.
async function pickConsultant(service, consultants, startMs, endMs, ignoreHoldId = null) {
  // round_robin: prefer the least-loaded (fewest confirmed bookings for this
  // service); single: strict priority order (already sorted).
  let ordered = consultants;
  if (service.assignment_policy === 'round_robin') {
    const { rows } = await pool.query(
      `SELECT consultant_id, COUNT(*)::int AS n
         FROM coexistence.bookings
        WHERE service_id = $1 AND status = 'confirmed'
        GROUP BY consultant_id`,
      [service.id]
    );
    const load = {};
    for (const r of rows) load[r.consultant_id] = r.n;
    ordered = [...consultants].sort((a, b) => (load[a.id] || 0) - (load[b.id] || 0) || a.priority - b.priority || a.id - b.id);
  }
  const from = new Date(startMs), to = new Date(endMs);
  for (const c of ordered) {
    let busy;
    try { busy = await busyFor(c, from, to, ignoreHoldId); }
    catch { continue; }
    const clash = busy.some(b => new Date(b.start) < to && from < new Date(b.end));
    if (!clash) return c;
  }
  return null;
}

// Create a short-lived hold on a chosen slot.
publicRouter.post('/public/booking/:slug/hold', bookingWriteLimiter, async (req, res) => {
  try {
    const service = await loadServiceBySlug(req.params.slug);
    if (!service || !service.active) return res.status(404).json({ error: 'Booking page not found' });
    const startMs = new Date(req.body?.start).getTime();
    if (!startMs || isNaN(startMs)) return res.status(400).json({ error: 'A valid start time is required' });
    const endMs = startMs + service.duration_minutes * 60000;
    if (startMs < Date.now() + (service.minimum_notice_minutes || 0) * 60000) {
      return res.status(409).json({ error: 'That time is no longer available.' });
    }
    const consultants = await loadEligibleConsultants(service.id);
    const chosen = await pickConsultant(service, consultants, startMs, endMs);
    if (!chosen) return res.status(409).json({ error: 'That time was just taken. Please pick another slot.' });

    const token = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO coexistence.booking_holds (token, service_id, consultant_id, starts_at, ends_at, expires_at)
       VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' minutes')::interval) RETURNING id, expires_at`,
      [token, service.id, chosen.id, new Date(startMs), new Date(endMs), String(HOLD_TTL_MINUTES)]
    );
    res.status(201).json({
      holdToken: token,
      expiresAt: rows[0].expires_at,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    });
  } catch (err) {
    console.error('[booking] hold error:', err.message);
    res.status(500).json({ error: 'Failed to hold the slot' });
  }
});

// Confirm a hold -> create booking + calendar event + Meet link (race-safe).
publicRouter.post('/public/booking/:slug/confirm', bookingWriteLimiter, async (req, res) => {
  const b = req.body || {};
  if (!b.holdToken) return res.status(400).json({ error: 'holdToken is required' });
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Your name is required' });

  const client = await pool.connect();
  let booking = null;
  let consultant = null;
  let service = null;
  try {
    await client.query('BEGIN');
    // Lock + read the hold.
    const { rows: holds } = await client.query(
      `SELECT * FROM coexistence.booking_holds WHERE token = $1 FOR UPDATE`, [b.holdToken]
    );
    const hold = holds[0];
    if (!hold || hold.status !== 'active' || new Date(hold.expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Your hold expired. Please choose a slot again.' });
    }
    const { rows: svc } = await client.query('SELECT * FROM coexistence.booking_services WHERE id = $1', [hold.service_id]);
    service = svc[0];
    const { rows: cons } = await client.query('SELECT * FROM coexistence.booking_consultants WHERE id = $1', [hold.consultant_id]);
    consultant = cons[0];
    if (!service || !consultant) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Slot no longer available.' }); }

    // Serialize confirms for this consultant, then re-check internal conflicts
    // (another confirmed booking overlapping this slot, ignoring this hold).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking-consultant-${consultant.id}`]);
    const { rows: clash } = await client.query(
      `SELECT 1 FROM coexistence.bookings
        WHERE consultant_id = $1 AND status = 'confirmed'
          AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
      [consultant.id, hold.starts_at, hold.ends_at]
    );
    if (clash.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That time was just booked. Please choose another.' }); }

    // Re-check external (Google) availability if this is a real calendar.
    try {
      const external = await gcal.getBusyIntervals({ consultant, from: hold.starts_at, to: hold.ends_at });
      const s = new Date(hold.starts_at), e = new Date(hold.ends_at);
      if (external.some(x => new Date(x.start) < e && s < new Date(x.end))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'That time is no longer free on the calendar. Please choose another.' });
      }
    } catch {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: 'Calendar temporarily unavailable. Please try again.' });
    }

    const cancelToken = crypto.randomUUID();
    const plan = paymentPlanFor(service);
    const { rows: ins } = await client.query(
      `INSERT INTO coexistence.bookings
         (service_id, consultant_id, status, starts_at, ends_at, time_zone,
          visitor_name, visitor_email, visitor_phone, notes,
          meeting_provider, assignment_reason, cancel_token,
          payment_status, amount_minor, currency)
       VALUES ($1,$2,'confirmed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        service.id, consultant.id, hold.starts_at, hold.ends_at, consultant.time_zone,
        String(b.name).trim(), encrypt(b.email), encrypt(b.phone), encrypt(b.notes),
        service.meeting_mode, `policy=${service.assignment_policy}`, cancelToken,
        plan.status, plan.amountMinor, service.currency || 'INR',
      ]
    );
    // Decrypt back for the post-commit calendar event + WhatsApp confirmation
    // (they need the plaintext email/phone); the stored row stays encrypted.
    booking = decryptContacts(ins[0]);
    await client.query(`UPDATE coexistence.booking_holds SET status = 'consumed' WHERE id = $1`, [hold.id]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('[booking] confirm tx error:', err.message);
    client.release();
    return res.status(500).json({ error: 'Failed to confirm the booking' });
  }
  client.release();

  // Side effects AFTER commit: create the calendar event + Meet link, persist
  // its ids. A failure here leaves a confirmed booking without a live event;
  // it's logged as an event for reconciliation rather than failing the visitor.
  try {
    const ev = await gcal.createEvent({ consultant, service, booking });
    await pool.query(
      `UPDATE coexistence.bookings
          SET meeting_url = $1, google_calendar_id = $2, google_event_id = $3, updated_at = NOW()
        WHERE id = $4`,
      [ev.meetUrl, ev.calendarId, ev.eventId, booking.id]
    );
    booking.meeting_url = ev.meetUrl;
    await recordEvent(booking.id, 'booking.confirmed', { mode: ev.mode });
  } catch (err) {
    console.error('[booking] calendar event creation failed:', err.message);
    await recordEvent(booking.id, 'booking.event_failed', { error: err.message });
  }

  // Settle payment for paid policies. In mock mode this succeeds instantly (no
  // real charge); a real provider would instead return a checkout URL and the
  // booking would be marked paid only on the verified webhook.
  let checkoutUrl = null;
  if (booking.payment_status === 'pending') {
    try {
      const intent = await payments.createIntent({ amountMinor: booking.amount_minor, currency: booking.currency, idempotencyKey: `bk-${booking.id}`, bookingRef: booking.id });
      if (intent.autoSucceed) {
        const pay = await payments.settleMock({ amountMinor: booking.amount_minor, currency: booking.currency });
        await pool.query(
          `INSERT INTO coexistence.payments (booking_id, provider, provider_payment_id, amount_minor, currency, status, paid_at)
           VALUES ($1,$2,$3,$4,$5,'paid',NOW())`,
          [booking.id, pay.provider, pay.providerPaymentId, booking.amount_minor, booking.currency]
        );
        await pool.query(`UPDATE coexistence.bookings SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`, [booking.id]);
        booking.payment_status = 'paid';
        await recordEvent(booking.id, 'booking.payment_paid', { provider: pay.provider, amountMinor: booking.amount_minor });
        // Accrue the consultant's earning (pending until the consultation completes).
        const earn = earningFor(consultant, booking.amount_minor);
        if (earn > 0) {
          await pool.query(
            `INSERT INTO coexistence.consultant_ledger_entries (consultant_id, booking_id, amount_minor, currency, status)
             VALUES ($1,$2,$3,$4,'pending')`,
            [consultant.id, booking.id, earn, booking.currency]
          );
        }
      } else if (intent.checkoutUrl) {
        checkoutUrl = intent.checkoutUrl; // real provider: client opens this to pay
      }
    } catch (err) {
      console.error('[booking] payment settle failed:', err.message);
      await recordEvent(booking.id, 'booking.payment_failed', { error: err.message });
    }
  }

  // Fire-and-forget WhatsApp confirmation (into the existing send flow). Never
  // blocks the visitor response and never fails the booking if delivery can't
  // happen (no session + no approved template, invalid number, etc.).
  bookingNotify.notifyBookingConfirmed({ booking, service, consultant })
    .catch(err => console.error('[booking] confirm notify failed:', err.message));

  // Give the consultant's login access to this customer's chat (both the owner
  // and the consultant can then respond). Fire-and-forget; never blocks booking.
  grantConsultantContactAccess({ consultant, service, booking })
    .catch(err => console.error('[booking] grant chat access failed:', err.message));

  res.status(201).json({
    id: booking.id,
    status: booking.status,
    start: booking.starts_at,
    end: booking.ends_at,
    timeZone: booking.time_zone,
    consultantName: consultant.display_name,
    meetingUrl: booking.meeting_url || null,
    cancelToken: booking.cancel_token,
    paymentStatus: booking.payment_status,
    amountMinor: booking.amount_minor,
    currency: booking.currency,
    checkoutUrl,
  });
});

// Public cancel via opaque token.
publicRouter.post('/public/booking/cancel/:token', bookingWriteLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.bookings WHERE cancel_token = $1', [req.params.token]);
    const bk = rows[0];
    if (!bk) return res.status(404).json({ error: 'Booking not found' });
    if (bk.status === 'cancelled') return res.json({ ok: true, alreadyCancelled: true });
    await cancelBookingRow(bk, 'visitor');
    res.json({ ok: true });
  } catch (err) {
    console.error('[booking] public cancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

// True if the consultant has no confirmed booking / active hold / external-busy
// overlap in [from,to). Excludes one booking id (the one being moved). On a
// calendar read error returns false (treat as busy — never risk a double-book).
async function isConsultantFree(consultant, from, to, ignoreBookingId = null) {
  const { rows: clash } = await pool.query(
    `SELECT 1 FROM coexistence.bookings
      WHERE consultant_id = $1 AND status = 'confirmed'
        AND ($4::bigint IS NULL OR id <> $4)
        AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
    [consultant.id, from, to, ignoreBookingId]
  );
  if (clash.length) return false;
  const { rows: held } = await pool.query(
    `SELECT 1 FROM coexistence.booking_holds
      WHERE consultant_id = $1 AND status = 'active' AND expires_at > NOW()
        AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
    [consultant.id, from, to]
  );
  if (held.length) return false;
  try {
    const ext = await gcal.getBusyIntervals({ consultant, from, to });
    return !ext.some(b => new Date(b.start) < to && from < new Date(b.end));
  } catch {
    return false;
  }
}

// Move a confirmed booking to a new time and/or consultant. Re-runs assignment,
// re-checks availability under an advisory lock, swaps the calendar event, and
// sends the "updated" notification. Returns { public } or { error, code }.
async function moveBooking(bk, newStartMs, { consultantId = null, actorType = 'system', actorId = null, requireNotice = true, kind = 'rescheduled', allowAnyConsultant = false } = {}) {
  const { rows: svc } = await pool.query('SELECT * FROM coexistence.booking_services WHERE id = $1', [bk.service_id]);
  const service = svc[0];
  if (!service) return { error: 'Service no longer exists', code: 409 };

  const startMs = Number(newStartMs);
  const endMs = startMs + service.duration_minutes * 60000;
  if (requireNotice && startMs < Date.now() + (service.minimum_notice_minutes || 0) * 60000) {
    return { error: 'That time is too soon. Please pick a later slot.', code: 409 };
  }
  const from = new Date(startMs), to = new Date(endMs);

  const eligible = await loadEligibleConsultants(service.id);
  // Choose the target consultant.
  let target = null;
  if (consultantId != null) {
    target = eligible.find(c => Number(c.id) === Number(consultantId));
    // Admin reassign override: an admin explicitly moving a booking may pick ANY
    // active consultant, even one not attached to this service as "eligible".
    if (!target && allowAnyConsultant) {
      const { rows: any } = await pool.query(
        'SELECT * FROM coexistence.booking_consultants WHERE id = $1 AND active = TRUE',
        [consultantId],
      );
      target = any[0] || null;
    }
    if (!target) {
      return {
        error: allowAnyConsultant
          ? 'That consultant no longer exists or is inactive.'
          : 'That consultant is not eligible for this service.',
        code: 400,
      };
    }
    if (!(await isConsultantFree(target, from, to, bk.id))) return { error: 'That consultant is busy at this time.', code: 409 };
  } else {
    // Keep the current consultant if still eligible + free, else pick another.
    const current = eligible.find(c => Number(c.id) === Number(bk.consultant_id));
    const ordered = current ? [current, ...eligible.filter(c => c.id !== current.id)] : eligible;
    for (const c of ordered) {
      if (await isConsultantFree(c, from, to, bk.id)) { target = c; break; }
    }
    if (!target) return { error: 'No consultant is free at that time. Please pick another slot.', code: 409 };
  }

  // Commit the internal move under an advisory lock + final conflict recheck.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking-consultant-${target.id}`]);
    const { rows: clash } = await client.query(
      `SELECT 1 FROM coexistence.bookings
        WHERE consultant_id = $1 AND status = 'confirmed' AND id <> $2
          AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
      [target.id, bk.id, from, to]
    );
    if (clash.length) { await client.query('ROLLBACK'); client.release(); return { error: 'That time was just taken. Please pick another.', code: 409 }; }
    await client.query(
      `UPDATE coexistence.bookings
          SET consultant_id = $1, starts_at = $2, ends_at = $3, time_zone = $4, updated_at = NOW()
        WHERE id = $5`,
      [target.id, from, to, target.time_zone, bk.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    client.release();
    console.error('[booking] move tx error:', err.message);
    return { error: 'Failed to update the booking', code: 500 };
  }
  client.release();

  // Swap the calendar event: cancel the old one, create a fresh one on the target.
  // Decrypt PII for the calendar event + notification (stored row stays encrypted).
  const moved = { ...decryptContacts(bk), consultant_id: target.id, starts_at: from, ends_at: to, time_zone: target.time_zone, meeting_url: null };
  try {
    const { rows: oldCons } = await pool.query('SELECT * FROM coexistence.booking_consultants WHERE id = $1', [bk.consultant_id]);
    if (oldCons[0] && bk.google_event_id) {
      await gcal.cancelEvent({ consultant: oldCons[0], calendarId: bk.google_calendar_id, eventId: bk.google_event_id });
    }
    const ev = await gcal.createEvent({ consultant: target, service, booking: moved });
    await pool.query(
      `UPDATE coexistence.bookings SET meeting_url = $1, google_calendar_id = $2, google_event_id = $3, updated_at = NOW() WHERE id = $4`,
      [ev.meetUrl, ev.calendarId, ev.eventId, bk.id]
    );
    moved.meeting_url = ev.meetUrl;
  } catch (err) {
    console.error('[booking] move calendar swap failed:', err.message);
    await recordEvent(bk.id, 'booking.event_failed', { error: err.message, stage: kind });
  }

  await recordEvent(bk.id, `booking.${kind}`, { by: actorType, consultantId: target.id }, actorType, actorId);
  bookingNotify.notifyBookingUpdated({ booking: moved, service, consultant: target, kind })
    .catch(err => console.error('[booking] update notify failed:', err.message));

  return {
    public: {
      id: bk.id,
      start: moved.starts_at,
      end: moved.ends_at,
      timeZone: moved.time_zone,
      consultantName: target.display_name,
      meetingUrl: moved.meeting_url || null,
      cancelToken: bk.cancel_token,
    },
    consultant: target,
    service,
  };
}

// Public reschedule via the booking's opaque token: move a confirmed booking to
// a new start time (re-assigns a free consultant if the current one is busy).
publicRouter.post('/public/booking/reschedule/:token', bookingWriteLimiter, async (req, res) => {
  try {
    const startMs = new Date(req.body?.start).getTime();
    if (!startMs || isNaN(startMs)) return res.status(400).json({ error: 'A valid start time is required' });
    const { rows } = await pool.query('SELECT * FROM coexistence.bookings WHERE cancel_token = $1', [req.params.token]);
    const bk = rows[0];
    if (!bk) return res.status(404).json({ error: 'Booking not found' });
    if (bk.status !== 'confirmed') return res.status(409).json({ error: `This booking is ${bk.status} and can’t be rescheduled.` });
    const result = await moveBooking(bk, startMs, { actorType: 'visitor', kind: 'rescheduled' });
    if (result.error) return res.status(result.code || 409).json({ error: result.error });
    res.json(result.public);
  } catch (err) {
    console.error('[booking] public reschedule error:', err.message);
    res.status(500).json({ error: 'Failed to reschedule' });
  }
});

// Payment provider webhook target (real gateways). In mock mode nothing calls
// this; it exists so a real provider (e.g. Razorpay) has a verified endpoint to
// POST success/failure to — the remaining integration verifies the signature
// here and flips the booking's payment_status.
publicRouter.post('/public/payments/webhook', async (req, res) => {
  try {
    const parsed = payments.verifyWebhook(req);
    if (!parsed) return res.status(202).json({ ok: true, note: 'mock mode / no verified provider event' });
    // Real provider handling (idempotent) goes here when the gateway is added.
    res.json({ ok: true });
  } catch (err) {
    console.error('[booking] payment webhook error:', err.message);
    res.status(400).json({ error: 'invalid webhook' });
  }
});

// When a consultant (who is a login) is booked with a customer, give that user
// access to the customer's chat — in ADDITION to whoever already owns it — so
// both can see and reply. Matches the customer by phone; prefers the service's
// office number when set. No-op if the consultant has no linked user or the
// customer has no chat yet.
async function grantConsultantContactAccess({ consultant, service, booking }) {
  if (!consultant?.user_id) return;
  const phone = booking.visitor_phone ? String(booking.visitor_phone).replace(/\D/g, '') : null;
  if (!phone) return;
  const params = [phone];
  let waCond = '';
  if (service?.wa_number) { params.push(String(service.wa_number).replace(/\D/g, '')); waCond = `AND regexp_replace(wa_number, '\\D', '', 'g') = $2`; }
  const { rows } = await pool.query(
    `SELECT wa_number, contact_number FROM coexistence.contacts
      WHERE regexp_replace(contact_number, '\\D', '', 'g') = $1 ${waCond}`,
    params
  );
  for (const c of rows) {
    await pool.query(
      `INSERT INTO coexistence.contact_user_access (wa_number, contact_number, user_id, reason)
       VALUES ($1,$2,$3,'consultant_booking') ON CONFLICT DO NOTHING`,
      [c.wa_number, c.contact_number, consultant.user_id]
    );
  }
  if (rows.length) await recordEvent(booking.id, 'booking.chat_access_granted', { userId: consultant.user_id, contacts: rows.length });
}

/* --------------------------- shared side effects -------------------------- */
async function recordEvent(bookingId, type, payload = {}, actorType = 'system', actorId = null) {
  try {
    await pool.query(
      `INSERT INTO coexistence.booking_events (booking_id, type, actor_type, actor_id, payload)
       VALUES ($1,$2,$3,$4,$5)`,
      [bookingId, type, actorType, actorId, payload]
    );
  } catch (err) {
    console.warn('[booking] recordEvent failed:', err.message);
  }
}
async function cancelBookingRow(bk, actorType, actorId = null) {
  const { rows: cons } = await pool.query('SELECT * FROM coexistence.booking_consultants WHERE id = $1', [bk.consultant_id]);
  const { rows: svc } = await pool.query('SELECT * FROM coexistence.booking_services WHERE id = $1', [bk.service_id]);
  await pool.query(
    `UPDATE coexistence.bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [bk.id]
  );
  // Reverse any not-yet-paid-out earning for this booking.
  await pool.query(
    `UPDATE coexistence.consultant_ledger_entries SET status = 'reversed', updated_at = NOW()
      WHERE booking_id = $1 AND status IN ('pending','available')`, [bk.id]
  );
  if (cons[0] && bk.google_event_id) {
    await gcal.cancelEvent({ consultant: cons[0], calendarId: bk.google_calendar_id, eventId: bk.google_event_id });
  }
  await recordEvent(bk.id, 'booking.cancelled', { by: actorType }, actorType, actorId);
  if (cons[0] && svc[0]) {
    bookingNotify.notifyBookingCancelled({ booking: decryptContacts(bk), service: svc[0], consultant: cons[0] })
      .catch(err => console.error('[booking] cancel notify failed:', err.message));
  }
}

/* ============================== DASHBOARD API ============================= */
const router = Router();

/* services */
router.get('/booking/services', async (req, res) => {
  try {
    // Franchise scope: a non-admin sees only services owned by an office
    // (wa_number) they're granted. Admin sees all (incl. unassigned/global).
    let where = '';
    const params = [];
    if (!isAdmin(req.user)) {
      const granted = await effectiveWaNumbers(req.user);
      params.push(granted);
      where = `WHERE wa_number = ANY($1::text[])`;
    }
    const { rows } = await pool.query(`SELECT * FROM coexistence.booking_services ${where} ORDER BY name ASC`, params);
    const { rows: links } = await pool.query(
      `SELECT sc.service_id, c.* FROM coexistence.booking_service_consultants sc
         JOIN coexistence.booking_consultants c ON c.id = sc.consultant_id`
    );
    const byService = new Map();
    for (const l of links) {
      if (!byService.has(l.service_id)) byService.set(l.service_id, []);
      byService.get(l.service_id).push(consultantShape(l));
    }
    res.json(rows.map(r => serviceShape(r, byService.get(r.id) || [])));
  } catch (err) {
    console.error('[booking] list services error:', err.message);
    res.status(500).json({ error: 'Failed to list services' });
  }
});

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

router.post('/booking/services', adminOnly, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Service name is required' });
  const slug = (b.slug && slugify(b.slug)) || slugify(b.name);
  if (!slug) return res.status(400).json({ error: 'Could not derive a slug from the name' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO coexistence.booking_services
         (name, slug, description, duration_minutes, buffer_before_minutes, buffer_after_minutes,
          minimum_notice_minutes, booking_horizon_days, slot_granularity_minutes, assignment_policy, active,
          payment_policy, price_minor, deposit_minor, currency, wa_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        b.name.trim(), slug, b.description || null,
        clampInt(b.durationMinutes, 5, 480, 30),
        clampInt(b.bufferBeforeMinutes, 0, 240, 0),
        clampInt(b.bufferAfterMinutes, 0, 240, 0),
        clampInt(b.minimumNoticeMinutes, 0, 100000, 120),
        clampInt(b.bookingHorizonDays, 1, 365, 30),
        clampInt(b.slotGranularityMinutes, 5, 120, 30),
        b.assignmentPolicy === 'single' ? 'single' : 'round_robin',
        !!b.active,
        paymentPolicyOf(b.paymentPolicy),
        clampInt(b.priceMinor, 0, 100000000, 0),
        clampInt(b.depositMinor, 0, 100000000, 0),
        (b.currency || 'INR').trim().slice(0, 8) || 'INR',
        b.waNumber ? String(b.waNumber).replace(/\D/g, '') : null,
      ]
    );
    auditLog({ actor: req.user, action: 'booking.service.create', targetType: 'booking_service', targetId: rows[0].id, payload: { slug } });
    res.status(201).json(serviceShape(rows[0], []));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A service with that slug already exists' });
    console.error('[booking] create service error:', err.message);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

router.put('/booking/services/:id', adminOnly, async (req, res) => {
  const b = req.body || {};
  const sets = ['updated_at = NOW()'];
  const params = [];
  let i = 1;
  const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };
  if (b.name != null) push('name', String(b.name).trim());
  if (b.description !== undefined) push('description', b.description || null);
  if (b.durationMinutes != null) push('duration_minutes', clampInt(b.durationMinutes, 5, 480, 30));
  if (b.bufferBeforeMinutes != null) push('buffer_before_minutes', clampInt(b.bufferBeforeMinutes, 0, 240, 0));
  if (b.bufferAfterMinutes != null) push('buffer_after_minutes', clampInt(b.bufferAfterMinutes, 0, 240, 0));
  if (b.minimumNoticeMinutes != null) push('minimum_notice_minutes', clampInt(b.minimumNoticeMinutes, 0, 100000, 120));
  if (b.bookingHorizonDays != null) push('booking_horizon_days', clampInt(b.bookingHorizonDays, 1, 365, 30));
  if (b.slotGranularityMinutes != null) push('slot_granularity_minutes', clampInt(b.slotGranularityMinutes, 5, 120, 30));
  if (b.assignmentPolicy != null) push('assignment_policy', b.assignmentPolicy === 'single' ? 'single' : 'round_robin');
  if (b.active != null) push('active', !!b.active);
  if (b.waNumber !== undefined) push('wa_number', b.waNumber ? String(b.waNumber).replace(/\D/g, '') : null);
  if (b.paymentPolicy != null) push('payment_policy', paymentPolicyOf(b.paymentPolicy));
  if (b.priceMinor != null) push('price_minor', clampInt(b.priceMinor, 0, 100000000, 0));
  if (b.depositMinor != null) push('deposit_minor', clampInt(b.depositMinor, 0, 100000000, 0));
  if (b.currency != null) push('currency', (b.currency || 'INR').trim().slice(0, 8) || 'INR');
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(`UPDATE coexistence.booking_services SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    // Guard: can't activate a service with no eligible consultants.
    if (rows[0].active) {
      const c = await loadEligibleConsultants(rows[0].id);
      if (c.length === 0) {
        await pool.query('UPDATE coexistence.booking_services SET active = FALSE WHERE id = $1', [rows[0].id]);
        return res.status(409).json({ error: 'Add at least one consultant before activating this service.' });
      }
    }
    res.json(serviceShape(rows[0]));
  } catch (err) {
    console.error('[booking] update service error:', err.message);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

router.delete('/booking/services/:id', adminOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM coexistence.booking_services WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Service not found' });
    auditLog({ actor: req.user, action: 'booking.service.delete', targetType: 'booking_service', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[booking] delete service error:', err.message);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// Set the full eligible-consultant list for a service.
router.put('/booking/services/:id/consultants', adminOnly, async (req, res) => {
  const ids = Array.isArray(req.body?.consultantIds) ? req.body.consultantIds : null;
  if (!ids) return res.status(400).json({ error: 'consultantIds array is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM coexistence.booking_service_consultants WHERE service_id = $1', [req.params.id]);
    let priority = 0;
    for (const cid of ids) {
      await client.query(
        `INSERT INTO coexistence.booking_service_consultants (service_id, consultant_id, priority)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [req.params.id, cid, priority++]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[booking] set consultants error:', err.message);
    res.status(500).json({ error: 'Failed to set consultants' });
  } finally {
    client.release();
  }
});

/* google calendar connect (for linking a consultant to a real calendar) */

// Start a Calendar-scoped Google consent. Returns a full-page auth URL the admin
// navigates to; on return the connected account appears in /booking/google/accounts.
router.post('/booking/google/authorize', adminOnly, async (req, res) => {
  try {
    if (!(await googleAuth.isConfigured())) {
      return res.status(501).json({ error: 'Add your Google OAuth Client ID, Secret and Redirect URI in Settings → Integrations → Google first.' });
    }
    const nonce = crypto.randomBytes(16).toString('hex');
    const authUrl = await googleAuth.buildAuthUrl({ userId: req.user.id, nonce, scopes: googleAuth.CALENDAR_SCOPES });
    res.json({ authUrl });
  } catch (err) {
    console.error('[booking] google authorize error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to start Google authorization' });
  }
});

// Connected Google accounts that can read/write Calendar — the pick-list for
// linking a consultant. Admin-managed, so it spans all users' google credentials.
router.get('/booking/google/accounts', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, account_label, scopes, health_status FROM coexistence.oauth_credentials
        WHERE provider = 'google' ORDER BY created_at DESC`
    );
    res.json(
      rows
        .filter(r => googleAuth.hasCalendarScope(r.scopes))
        .map(r => ({ id: r.id, label: r.account_label, healthy: r.health_status === 'ok' }))
    );
  } catch (err) {
    console.error('[booking] google accounts error:', err.message);
    res.status(500).json({ error: 'Failed to list Google accounts' });
  }
});

/* consultants */
router.get('/booking/consultants', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.booking_consultants ORDER BY display_name ASC');
    res.json(rows.map(consultantShape));
  } catch (err) {
    console.error('[booking] list consultants error:', err.message);
    res.status(500).json({ error: 'Failed to list consultants' });
  }
});

router.post('/booking/consultants', adminOnly, async (req, res) => {
  const b = req.body || {};
  if (!b.displayName || !b.displayName.trim()) return res.status(400).json({ error: 'Consultant name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO coexistence.booking_consultants
         (display_name, email, calendar_id, time_zone, working_hours, google_credential_id, active,
          commission_type, commission_fixed_minor, commission_bps, user_id)
       VALUES ($1,$2,$3,$4,COALESCE($5, '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}'::jsonb),$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        b.displayName.trim(), b.email || null, b.calendarId || 'primary',
        b.timeZone || 'Asia/Kolkata',
        b.workingHours ? JSON.stringify(b.workingHours) : null,
        b.googleCredentialId || null,
        b.active === false ? false : true,
        ['fixed', 'percentage'].includes(b.commissionType) ? b.commissionType : 'none',
        clampInt(b.commissionFixedMinor, 0, 100000000, 0),
        clampInt(b.commissionBps, 0, 10000, 0),
        b.userId || null,
      ]
    );
    res.status(201).json(consultantShape(rows[0]));
  } catch (err) {
    console.error('[booking] create consultant error:', err.message);
    res.status(500).json({ error: 'Failed to create consultant' });
  }
});

router.put('/booking/consultants/:id', adminOnly, async (req, res) => {
  const b = req.body || {};
  const sets = ['updated_at = NOW()'];
  const params = [];
  let i = 1;
  const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };
  if (b.displayName != null) push('display_name', String(b.displayName).trim());
  if (b.email !== undefined) push('email', b.email || null);
  if (b.calendarId != null) push('calendar_id', b.calendarId || 'primary');
  if (b.timeZone != null) push('time_zone', b.timeZone);
  if (b.workingHours !== undefined) push('working_hours', JSON.stringify(b.workingHours || {}));
  if (b.googleCredentialId !== undefined) push('google_credential_id', b.googleCredentialId || null);
  if (b.active != null) push('active', !!b.active);
  if (b.userId !== undefined) push('user_id', b.userId || null);
  if (b.commissionType != null) push('commission_type', ['fixed', 'percentage'].includes(b.commissionType) ? b.commissionType : 'none');
  if (b.commissionFixedMinor != null) push('commission_fixed_minor', clampInt(b.commissionFixedMinor, 0, 100000000, 0));
  if (b.commissionBps != null) push('commission_bps', clampInt(b.commissionBps, 0, 10000, 0));
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(`UPDATE coexistence.booking_consultants SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Consultant not found' });
    res.json(consultantShape(rows[0]));
  } catch (err) {
    console.error('[booking] update consultant error:', err.message);
    res.status(500).json({ error: 'Failed to update consultant' });
  }
});

router.delete('/booking/consultants/:id', adminOnly, async (req, res) => {
  try {
    const { rows: fut } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM coexistence.bookings
        WHERE consultant_id = $1 AND status = 'confirmed' AND starts_at > NOW()`, [req.params.id]
    );
    if (fut[0].n > 0) return res.status(409).json({ error: 'Reassign or cancel this consultant\'s upcoming bookings first.' });
    const { rowCount } = await pool.query('DELETE FROM coexistence.booking_consultants WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Consultant not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[booking] delete consultant error:', err.message);
    res.status(500).json({ error: 'Failed to delete consultant' });
  }
});

/* bookings */
router.get('/booking/bookings', async (req, res) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = '1=1';
    if (status && ['confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) {
      params.push(status); where += ` AND b.status = $${params.length}`;
    }
    // Franchise scope: a non-admin sees only bookings whose service belongs to an
    // office (wa_number) they're granted.
    if (!isAdmin(req.user)) {
      const granted = await effectiveWaNumbers(req.user);
      params.push(granted); where += ` AND s.wa_number = ANY($${params.length}::text[])`;
    }
    const { rows } = await pool.query(
      `SELECT b.*, s.name AS service_name, c.display_name AS consultant_name
         FROM coexistence.bookings b
         JOIN coexistence.booking_services s ON s.id = b.service_id
         JOIN coexistence.booking_consultants c ON c.id = b.consultant_id
        WHERE ${where}
        ORDER BY b.starts_at DESC
        LIMIT 500`,
      params
    );
    res.json(rows.map(bookingShape));
  } catch (err) {
    console.error('[booking] list bookings error:', err.message);
    res.status(500).json({ error: 'Failed to list bookings' });
  }
});

router.post('/booking/bookings/:id/cancel', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.bookings WHERE id = $1', [req.params.id]);
    const bk = rows[0];
    if (!bk) return res.status(404).json({ error: 'Booking not found' });
    if (bk.status !== 'confirmed') return res.status(409).json({ error: `Booking is ${bk.status}` });
    await cancelBookingRow(bk, 'admin', req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[booking] admin cancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

// Reassign a confirmed booking to a different eligible consultant (same time).
router.post('/booking/bookings/:id/reassign', adminOnly, async (req, res) => {
  const consultantId = req.body?.consultantId;
  if (!consultantId) return res.status(400).json({ error: 'consultantId is required' });
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.bookings WHERE id = $1', [req.params.id]);
    const bk = rows[0];
    if (!bk) return res.status(404).json({ error: 'Booking not found' });
    if (bk.status !== 'confirmed') return res.status(409).json({ error: `Booking is ${bk.status}` });
    if (Number(bk.consultant_id) === Number(consultantId)) return res.status(409).json({ error: 'Booking is already with that consultant.' });
    const result = await moveBooking(bk, new Date(bk.starts_at).getTime(), {
      consultantId, actorType: 'admin', actorId: req.user.id, requireNotice: false, kind: 'reassigned',
      allowAnyConsultant: true,
    });
    if (result.error) return res.status(result.code || 409).json({ error: result.error });
    res.json({ ok: true, ...result.public });
  } catch (err) {
    console.error('[booking] reassign error:', err.message);
    res.status(500).json({ error: 'Failed to reassign booking' });
  }
});

router.post('/booking/bookings/:id/status', adminOnly, async (req, res) => {
  const status = req.body?.status;
  if (!['completed', 'no_show'].includes(status)) return res.status(400).json({ error: 'status must be completed or no_show' });
  try {
    const { rows } = await pool.query(
      `UPDATE coexistence.bookings SET status = $1, updated_at = NOW() WHERE id = $2 AND status = 'confirmed' RETURNING *`,
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Only a confirmed booking can be marked completed/no-show' });
    // Consultation delivered -> the earning becomes available; a no-show reverses it.
    if (status === 'completed') {
      await pool.query(`UPDATE coexistence.consultant_ledger_entries SET status = 'available', updated_at = NOW() WHERE booking_id = $1 AND status = 'pending'`, [rows[0].id]);
    } else {
      await pool.query(`UPDATE coexistence.consultant_ledger_entries SET status = 'reversed', updated_at = NOW() WHERE booking_id = $1 AND status IN ('pending','available')`, [rows[0].id]);
    }
    await recordEvent(rows[0].id, `booking.${status}`, {}, 'admin', req.user.id);
    res.json(bookingShape(rows[0]));
  } catch (err) {
    console.error('[booking] status error:', err.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

/* payouts */
// Per-consultant earning summary (pending / available / paid) + recent payouts.
router.get('/booking/payouts', adminOnly, async (req, res) => {
  try {
    const { rows: bal } = await pool.query(
      `SELECT c.id, c.display_name,
              COALESCE(SUM(l.amount_minor) FILTER (WHERE l.status = 'pending'),   0) AS pending,
              COALESCE(SUM(l.amount_minor) FILTER (WHERE l.status = 'available'), 0) AS available,
              COALESCE(SUM(l.amount_minor) FILTER (WHERE l.status = 'paid'),      0) AS paid
         FROM coexistence.booking_consultants c
         LEFT JOIN coexistence.consultant_ledger_entries l ON l.consultant_id = c.id
        GROUP BY c.id, c.display_name
        ORDER BY c.display_name ASC`
    );
    const { rows: payouts } = await pool.query(
      `SELECT p.*, c.display_name AS consultant_name FROM coexistence.consultant_payouts p
         JOIN coexistence.booking_consultants c ON c.id = p.consultant_id
        ORDER BY p.created_at DESC LIMIT 50`
    );
    res.json({
      consultants: bal.map(r => ({
        id: r.id, name: r.display_name,
        pendingMinor: Number(r.pending), availableMinor: Number(r.available), paidMinor: Number(r.paid),
      })),
      payouts: payouts.map(p => ({
        id: p.id, consultantName: p.consultant_name, provider: p.provider,
        amountMinor: p.amount_minor, currency: p.currency, status: p.status, paidAt: p.paid_at, createdAt: p.created_at,
      })),
    });
  } catch (err) {
    console.error('[booking] payouts summary error:', err.message);
    res.status(500).json({ error: 'Failed to load payouts' });
  }
});

// Settle a consultant's available balance. Mock provider marks it paid instantly;
// a real provider + KYC are required before this moves real money (spec §11B).
router.post('/booking/consultants/:id/payout', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sum } = await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::int AS available, MIN(currency) AS currency
         FROM coexistence.consultant_ledger_entries
        WHERE consultant_id = $1 AND status = 'available' FOR UPDATE`,
      [req.params.id]
    );
    const available = sum[0].available;
    if (available <= 0) { await client.query('ROLLBACK'); client.release(); return res.status(409).json({ error: 'No available balance to pay out.' }); }
    const { rows: po } = await client.query(
      `INSERT INTO coexistence.consultant_payouts (consultant_id, provider, provider_payout_id, amount_minor, currency, status, paid_at)
       VALUES ($1,'mock',$2,$3,$4,'paid',NOW()) RETURNING *`,
      [req.params.id, `mock_po_${crypto.randomUUID()}`, available, sum[0].currency || 'INR']
    );
    await client.query(
      `UPDATE coexistence.consultant_ledger_entries SET status = 'paid', payout_id = $1, updated_at = NOW()
        WHERE consultant_id = $2 AND status = 'available'`,
      [po[0].id, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, payoutId: po[0].id, amountMinor: available, provider: 'mock' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('[booking] payout error:', err.message);
    res.status(500).json({ error: 'Failed to run payout' });
  } finally {
    client.release();
  }
});

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
const PAYMENT_POLICIES = ['free', 'full_payment_required', 'deposit_required', 'pay_later', 'manual_approval'];
function paymentPolicyOf(p) { return PAYMENT_POLICIES.includes(p) ? p : 'free'; }
// Amount owed (minor units) for a service's policy, and the booking's starting
// payment_status. Mock provider settles 'pending' -> 'paid' after confirm.
function paymentPlanFor(service) {
  const policy = service.payment_policy || 'free';
  const price = service.price_minor || 0;
  const deposit = service.deposit_minor || 0;
  if (policy === 'full_payment_required') return { policy, amountMinor: price, status: 'pending' };
  if (policy === 'deposit_required')      return { policy, amountMinor: deposit || price, status: 'pending' };
  if (policy === 'pay_later' || policy === 'manual_approval') return { policy, amountMinor: price, status: 'due' };
  return { policy: 'free', amountMinor: 0, status: 'not_required' };
}
// Consultant earning (minor units) for a paid booking, per their commission config.
function earningFor(consultant, amountMinor) {
  if (!consultant) return 0;
  if (consultant.commission_type === 'fixed') return consultant.commission_fixed_minor || 0;
  if (consultant.commission_type === 'percentage') return Math.round((amountMinor || 0) * (consultant.commission_bps || 0) / 10000);
  return 0;
}

module.exports = { router, publicRouter };
