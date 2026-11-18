// Booking -> WhatsApp notifications.
//
// Reuses the SAME send machinery as the auto follow-up flow (messageSender +
// metaSend), so a booking confirmation/cancellation lands in the visitor's
// WhatsApp thread and shows in Chats like any other outbound message.
//
// WhatsApp delivery rule (Meta Cloud API): free-form text is only allowed inside
// the 24-hour customer-service window (the visitor messaged the business in the
// last 24h). A web visitor usually has NO open window, so outside it we must use
// a Meta-APPROVED template. Therefore:
//   * open 24h session  -> send friendly free-form text (works out of the box)
//   * otherwise + a template is configured -> send that template
//   * otherwise          -> skip WhatsApp (logged); the visitor already has the
//                           Meet link on the confirmation page + calendar invite.
// Every attempt is recorded in booking_events, and a failure NEVER breaks the
// booking (fire-and-forget from the confirm/cancel paths).
//
// Config (env):
//   BOOKING_CONFIRM_TEMPLATE  approved template for confirmations (optional)
//   BOOKING_CANCEL_TEMPLATE   approved template for cancellations (optional)
//   BOOKING_TEMPLATE_LANG     template language code (default 'en')
// Expected template body variables, in order: {{1}} visitor name,
//   {{2}} service name, {{3}} date & time, {{4}} consultant, {{5}} meet link.

const pool = require('../db');
const { resolveAccount, insertPendingRow, markSent, markFailed, secondsSinceLastIncoming } = require('./messageSender');
const { sendText, sendTemplate } = require('../integrations/metaSend');
const { sendEmail, renderEmailHtml } = require('./emailSender');

const TEMPLATE_LANG = process.env.BOOKING_TEMPLATE_LANG || 'en';
const SESSION_WINDOW_SECONDS = 24 * 3600;

// Digits-only. This product is India-first (default zone Asia/Kolkata): a bare
// 10-digit mobile is assumed +91 so common form entries still reach WhatsApp.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) d = '91' + d;         // local 10-digit -> India E.164 digits
  return d;
}

function fmtWhen(booking) {
  try {
    return new Date(booking.starts_at).toLocaleString('en-IN', {
      timeZone: booking.time_zone || 'Asia/Kolkata',
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return new Date(booking.starts_at).toISOString(); }
}

async function recordEvent(bookingId, type, payload = {}) {
  try {
    await pool.query(
      `INSERT INTO coexistence.booking_events (booking_id, type, actor_type, payload)
       VALUES ($1,$2,'system',$3)`,
      [bookingId, type, payload]
    );
  } catch (err) {
    console.warn('[bookingNotify] recordEvent failed:', err.message);
  }
}

/**
 * Core sender. Chooses text (in-window) vs template (out-of-window), inserts the
 * outbound chat row, sends, and logs the outcome. Returns a small result object.
 */
async function sendBookingWhatsApp({ booking, service, consultant, kind, text, templateName }) {
  const to = normalizePhone(booking.visitor_phone);
  if (!to) {
    await recordEvent(booking.id, 'booking.notification_skipped', { channel: 'whatsapp', kind, reason: 'no_phone' });
    return { skipped: true, reason: 'no_phone' };
  }

  const { account, error } = await resolveAccount({});
  if (error || !account) {
    await recordEvent(booking.id, 'booking.notification_failed', { channel: 'whatsapp', kind, reason: error || 'no_account' });
    return { failed: true, reason: error || 'no_account' };
  }

  // Is there an open 24h session with this visitor on this number?
  let withinWindow = false;
  try {
    const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber: to });
    withinWindow = secs != null && secs < SESSION_WINDOW_SECONDS;
  } catch { /* treat as out-of-window */ }

  try {
    if (withinWindow) {
      const localId = await insertPendingRow({ account, toNumber: to, messageType: 'text', messageBody: text });
      const result = await sendText({ accessToken: account.accessToken, phoneNumberId: account.phoneNumberId, to, body: text });
      const wamid = result?.messages?.[0]?.id;
      if (wamid) await markSent(localId, wamid); else await markFailed(localId, 'no wamid returned');
      await recordEvent(booking.id, 'booking.notification_sent', { channel: 'whatsapp', kind, via: 'session_text', wamid: wamid || null });
      return { sent: true, via: 'session_text' };
    }

    if (!templateName) {
      await recordEvent(booking.id, 'booking.notification_skipped', { channel: 'whatsapp', kind, reason: 'no_session_and_no_template' });
      return { skipped: true, reason: 'no_session_and_no_template' };
    }

    const params = [
      booking.visitor_name || 'there',
      service.name,
      fmtWhen(booking),
      consultant.display_name || 'our consultant',
      booking.meeting_url || 'see your calendar invite',
    ].map(t => ({ type: 'text', text: String(t) }));
    const components = [{ type: 'body', parameters: params }];

    const localId = await insertPendingRow({
      account, toNumber: to, messageType: 'template',
      messageBody: text, // human-readable mirror in the thread
      templateMeta: { name: templateName, language: TEMPLATE_LANG },
    });
    const result = await sendTemplate({
      accessToken: account.accessToken, phoneNumberId: account.phoneNumberId,
      to, templateName, languageCode: TEMPLATE_LANG, components,
    });
    const wamid = result?.messages?.[0]?.id;
    if (wamid) await markSent(localId, wamid); else await markFailed(localId, 'no wamid returned');
    await recordEvent(booking.id, 'booking.notification_sent', { channel: 'whatsapp', kind, via: 'template', template: templateName, wamid: wamid || null });
    return { sent: true, via: 'template' };
  } catch (err) {
    // e.g. template not approved yet, or number not on WhatsApp — logged, not fatal.
    await recordEvent(booking.id, 'booking.notification_failed', { channel: 'whatsapp', kind, reason: err.message });
    return { failed: true, reason: err.message };
  }
}

// Email the visitor (mock/log by default; real over SMTP when configured).
async function sendBookingEmail({ booking, service, consultant, kind, subject, heading, intro }) {
  const to = booking.visitor_email;
  if (!to) {
    await recordEvent(booking.id, 'booking.email_skipped', { kind, reason: 'no_email' });
    return { skipped: true };
  }
  const rows = [
    ['Service', service.name],
    ['When', `${fmtWhen(booking)} (${booking.time_zone})`],
    ['Consultant', consultant.display_name],
  ];
  const html = renderEmailHtml({ heading, intro, rows, meetUrl: booking.meeting_url, footer: 'Booked via Neubrain Solutions.' });
  const text = [heading, '', intro || '', '',
    `Service: ${service.name}`,
    `When: ${fmtWhen(booking)} (${booking.time_zone})`,
    `Consultant: ${consultant.display_name}`,
    booking.meeting_url ? `Join: ${booking.meeting_url}` : '',
  ].filter(Boolean).join('\n');
  try {
    const r = await sendEmail({ to, subject, html, text });
    await recordEvent(booking.id, 'booking.email_sent', { kind, mode: r.mode || 'unknown' });
    return r;
  } catch (err) {
    await recordEvent(booking.id, 'booking.email_failed', { kind, reason: err.message });
    return { failed: true, reason: err.message };
  }
}

// Fan out one booking event to every channel (WhatsApp + email), independently.
function dispatch(channels) { return Promise.allSettled(channels); }

async function notifyBookingConfirmed({ booking, service, consultant }) {
  const when = fmtWhen(booking);
  const text =
    `✅ Your ${service.name} consultation is confirmed.\n\n` +
    `🗓 ${when} (${booking.time_zone})\n` +
    `👤 With ${consultant.display_name}\n` +
    (booking.meeting_url ? `🎥 Join: ${booking.meeting_url}\n` : '') +
    `\nWe’ve also sent a calendar invite. Reply here if you need to reschedule.`;
  return dispatch([
    sendBookingWhatsApp({ booking, service, consultant, kind: 'confirmed', text, templateName: process.env.BOOKING_CONFIRM_TEMPLATE || null }),
    sendBookingEmail({ booking, service, consultant, kind: 'confirmed', subject: `Booking confirmed — ${service.name}`, heading: 'Your consultation is confirmed', intro: 'Thanks for booking. Here are your details.' }),
  ]);
}

async function notifyBookingCancelled({ booking, service, consultant }) {
  const when = fmtWhen(booking);
  const text =
    `Your ${service.name} consultation on ${when} (${booking.time_zone}) has been cancelled.\n` +
    `If this wasn’t you, reply here and we’ll help re-book.`;
  return dispatch([
    sendBookingWhatsApp({ booking, service, consultant, kind: 'cancelled', text, templateName: process.env.BOOKING_CANCEL_TEMPLATE || null }),
    sendBookingEmail({ booking, service, consultant, kind: 'cancelled', subject: `Booking cancelled — ${service.name}`, heading: 'Your consultation was cancelled', intro: 'This booking has been cancelled. Reply if you’d like to re-book.' }),
  ]);
}

// Reminder ahead of the appointment. `kind` is '24h' or '1h'; the 1h variant
// leads with the join link. Uses env BOOKING_REMINDER_TEMPLATE out-of-session.
async function notifyBookingReminder({ booking, service, consultant, kind }) {
  const when = fmtWhen(booking);
  const lead = kind === '1h' ? 'starts in about an hour' : 'is coming up';
  const head = kind === '1h' ? '⏰ Starting soon' : '⏰ Reminder';
  const text =
    `${head}: your ${service.name} consultation ${lead}.\n\n` +
    `🗓 ${when} (${booking.time_zone})\n` +
    `👤 With ${consultant.display_name}\n` +
    (booking.meeting_url ? `🎥 Join: ${booking.meeting_url}\n` : '') +
    `\nSee you soon!`;
  return dispatch([
    sendBookingWhatsApp({ booking, service, consultant, kind: `reminder_${kind}`, text, templateName: process.env.BOOKING_REMINDER_TEMPLATE || null }),
    sendBookingEmail({ booking, service, consultant, kind: `reminder_${kind}`, subject: `${head.replace(/[^\w ]/g, '').trim()} — ${service.name}`, heading: `${head}: ${service.name}`, intro: `Your consultation ${lead}.` }),
  ]);
}

// Booking changed — rescheduled (new time) or reassigned (new consultant).
// `kind` is 'rescheduled' | 'reassigned'.
async function notifyBookingUpdated({ booking, service, consultant, kind }) {
  const when = fmtWhen(booking);
  const lead = kind === 'reassigned'
    ? `Your ${service.name} consultation now has a new consultant.`
    : `Your ${service.name} consultation has been moved to a new time.`;
  const text =
    `🔄 ${lead}\n\n` +
    `🗓 ${when} (${booking.time_zone})\n` +
    `👤 With ${consultant.display_name}\n` +
    (booking.meeting_url ? `🎥 Join: ${booking.meeting_url}\n` : '') +
    `\nReply here if this time no longer works.`;
  return dispatch([
    sendBookingWhatsApp({ booking, service, consultant, kind, text, templateName: process.env.BOOKING_UPDATE_TEMPLATE || null }),
    sendBookingEmail({ booking, service, consultant, kind, subject: `Booking updated — ${service.name}`, heading: kind === 'reassigned' ? 'Your consultant has changed' : 'Your consultation was rescheduled', intro: lead }),
  ]);
}

// Post-appointment recovery: the booking time passed and it was never marked
// completed. We can't detect attendance, so this is a gentle "did we miss you?"
// nudge with a re-book offer — routed on both channels.
async function notifyBookingRecovery({ booking, service, consultant }) {
  const when = fmtWhen(booking);
  const text =
    `We noticed your ${service.name} consultation (${when}, ${booking.time_zone}) has passed.\n` +
    `If we missed each other, just reply here and we’ll help you re-book.`;
  return dispatch([
    sendBookingWhatsApp({ booking, service, consultant, kind: 'no_show_followup', text, templateName: process.env.BOOKING_RECOVERY_TEMPLATE || null }),
    sendBookingEmail({ booking, service, consultant, kind: 'no_show_followup', subject: `We missed you — ${service.name}`, heading: 'Did we miss each other?', intro: `Your ${service.name} consultation time has passed. Reply to re-book at a time that suits you.` }),
  ]);
}

module.exports = {
  notifyBookingConfirmed, notifyBookingCancelled, notifyBookingReminder,
  notifyBookingUpdated, notifyBookingRecovery, normalizePhone,
};
