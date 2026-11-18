// Google Calendar adapter for the booking module.
//
// Two interchangeable implementations behind one interface so the whole booking
// flow works BEFORE any Google Workspace app is connected:
//
//   * REAL  — used when a consultant has a linked google_credential_id AND the
//             workspace Google OAuth app is configured (migration 055). Reads
//             free/busy and creates/cancels events (with a Google Meet link) on
//             the consultant's calendar via googleapis, reusing googleAuth for
//             token refresh.
//   * MOCK  — used otherwise (no credential, app not configured, or
//             BOOKING_CALENDAR_MODE=mock). Treats the external calendar as
//             always-free and returns a synthetic Meet URL, so bookings, holds,
//             assignment, the dashboard and the public page are all testable on
//             synthetic data. Internal conflicts (our own holds/bookings) are
//             still enforced by the availability service, not here.
//
// The only thing needed to "go live" is: configure the Google OAuth app, add
// Calendar scope (see CALENDAR_SCOPES), have each consultant connect, and set
// booking_consultants.google_credential_id. No code change required.

const crypto = require('crypto');
const { google } = require('googleapis');
const googleAuth = require('./googleAuth');

// Least-privilege Calendar scopes. calendar.events lets us insert/cancel the
// events WE create and read free/busy; calendar.freebusy would be narrower but
// event creation needs write access anyway.
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

const FORCE_MOCK = String(process.env.BOOKING_CALENDAR_MODE || '').toLowerCase() === 'mock';

/**
 * Decide whether to use the real Google path for a given consultant.
 * @param {{google_credential_id?: number|null}} consultant
 */
async function useRealFor(consultant) {
  if (FORCE_MOCK) return false;
  if (!consultant || !consultant.google_credential_id) return false;
  try {
    return await googleAuth.isConfigured();
  } catch {
    return false;
  }
}

/** Build an authenticated Calendar client for a consultant's linked credential. */
async function buildAuthedClient(consultant) {
  const oauth2 = await googleAuth.buildOAuthClient();
  const accessToken = await googleAuth.getAccessToken(consultant.google_credential_id);
  oauth2.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

/* ------------------------------- free / busy ------------------------------ */
/**
 * Busy intervals on the consultant's EXTERNAL calendar between [from, to).
 * Returns [{ start: Date, end: Date }]. Mock returns [] (always free).
 * @returns {Promise<Array<{start: Date, end: Date}>>}
 */
async function getBusyIntervals({ consultant, from, to }) {
  if (!(await useRealFor(consultant))) return [];
  try {
    const cal = await buildAuthedClient(consultant);
    const calendarId = consultant.calendar_id || 'primary';
    const { data } = await cal.freebusy.query({
      requestBody: {
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const cal0 = (data.calendars && data.calendars[calendarId]) || {};
    return (cal0.busy || []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
  } catch (err) {
    // Fail safe: if we cannot read the calendar we must NOT silently treat the
    // consultant as free (could double-book a real person). Surface it so the
    // caller can exclude this consultant / show a retry.
    const e = new Error(`freebusy failed for consultant ${consultant.id}: ${err.message}`);
    e.code = 'FREEBUSY_FAILED';
    throw e;
  }
}

/* ----------------------------- event creation ----------------------------- */
/**
 * Create the calendar event + meeting link for a confirmed booking.
 * @returns {Promise<{calendarId: string, eventId: string, meetUrl: string|null, mode: 'real'|'mock'}>}
 */
async function createEvent({ consultant, service, booking }) {
  const summary = `${service.name} — ${booking.visitor_name}`;
  const description = [
    `Service: ${service.name}`,
    booking.visitor_email ? `Visitor email: ${booking.visitor_email}` : null,
    booking.visitor_phone ? `Visitor phone: ${booking.visitor_phone}` : null,
    booking.notes ? `Notes: ${booking.notes}` : null,
    'Booked via Neubrain Solutions.',
  ].filter(Boolean).join('\n');

  if (!(await useRealFor(consultant))) {
    // Synthetic Meet code shaped like a real one: aaa-bbbb-ccc.
    const seg = (n) => crypto.randomBytes(8).toString('hex').replace(/[^a-z]/gi, 'x').slice(0, n).toLowerCase().padEnd(n, 'x');
    const meetUrl = `https://meet.google.com/${seg(3)}-${seg(4)}-${seg(3)}`;
    return {
      calendarId: consultant.calendar_id || 'primary',
      eventId: `mock-${crypto.randomUUID()}`,
      meetUrl,
      mode: 'mock',
    };
  }

  const cal = await buildAuthedClient(consultant);
  const calendarId = consultant.calendar_id || 'primary';
  const attendees = [];
  if (booking.visitor_email) attendees.push({ email: booking.visitor_email, displayName: booking.visitor_name });
  if (consultant.email) attendees.push({ email: consultant.email, organizer: true });

  const { data } = await cal.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: {
      summary,
      description,
      start: { dateTime: new Date(booking.starts_at).toISOString(), timeZone: booking.time_zone },
      end:   { dateTime: new Date(booking.ends_at).toISOString(),   timeZone: booking.time_zone },
      attendees,
      extendedProperties: { private: { forgechat_booking: String(booking.id || '') } },
      conferenceData: {
        createRequest: {
          requestId: `forgechat-${booking.id || crypto.randomUUID()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });

  const meetUrl = data.hangoutLink
    || (data.conferenceData?.entryPoints || []).find(e => e.entryPointType === 'video')?.uri
    || null;
  return { calendarId, eventId: data.id, meetUrl, mode: 'real' };
}

/* ------------------------------ cancellation ------------------------------ */
async function cancelEvent({ consultant, calendarId, eventId }) {
  if (!eventId || String(eventId).startsWith('mock-')) return; // nothing real to cancel
  if (!(await useRealFor(consultant))) return;
  try {
    const cal = await buildAuthedClient(consultant);
    await cal.events.delete({ calendarId: calendarId || 'primary', eventId, sendUpdates: 'all' });
  } catch (err) {
    // Non-fatal: the booking is cancelled in our DB regardless; a leftover
    // calendar event is reconciled/cleaned later.
    console.warn(`[googleCalendar] cancelEvent failed for event ${eventId}: ${err.message}`);
  }
}

module.exports = {
  CALENDAR_SCOPES,
  getBusyIntervals,
  createEvent,
  cancelEvent,
  useRealFor,
};
