// Booking module unit tests (pure logic — no DB required).
//   * availability slot generation: working hours, buffers, notice, horizon,
//     busy-interval subtraction, time-zone/DST correctness.
//   * visitor phone normalization for WhatsApp.

const { test } = require('node:test');
const assert = require('node:assert');

const { consultantSlotStarts, zonedWallToUtc } = require('../src/services/bookingAvailability');
const { normalizePhone } = require('../src/services/bookingNotifications');
const { encrypt, decryptContacts } = require('../src/services/bookingCrypto');
const { sendEmail, isConfigured, renderEmailHtml } = require('../src/services/emailSender');

// A fixed reference "now": Mon 2026-08-10 00:00:00 UTC.
const NOW = Date.UTC(2026, 7, 10, 0, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

function svc(overrides = {}) {
  return {
    duration_minutes: 30,
    slot_granularity_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    minimum_notice_minutes: 120,
    booking_horizon_days: 30,
    ...overrides,
  };
}
function mondayConsultant(hours = [['09:00', '11:00']]) {
  return { time_zone: 'Asia/Kolkata', working_hours: { '1': hours } }; // ISO weekday 1 = Monday
}
const rangeFrom = iso(NOW);
const rangeTo = iso(NOW + 3 * 86400000);

test('zonedWallToUtc converts IST wall-clock to UTC (+05:30)', () => {
  assert.equal(zonedWallToUtc(2026, 8, 10, 9, 0, 'Asia/Kolkata').toISOString(), '2026-08-10T03:30:00.000Z');
});

test('generates one slot per granularity step inside the working window', () => {
  const slots = consultantSlotStarts({ service: svc(), consultant: mondayConsultant(), from: rangeFrom, to: rangeTo, busy: [], now: NOW });
  // Mon 09:00,09:30,10:00,10:30 IST => 03:30,04:00,04:30,05:00 UTC
  assert.deepEqual(slots.map(iso), [
    '2026-08-10T03:30:00.000Z', '2026-08-10T04:00:00.000Z',
    '2026-08-10T04:30:00.000Z', '2026-08-10T05:00:00.000Z',
  ]);
});

test('a busy interval removes only the overlapping slot', () => {
  const busy = [{ start: zonedWallToUtc(2026, 8, 10, 9, 0, 'Asia/Kolkata'), end: zonedWallToUtc(2026, 8, 10, 9, 30, 'Asia/Kolkata') }];
  const slots = consultantSlotStarts({ service: svc(), consultant: mondayConsultant(), from: rangeFrom, to: rangeTo, busy, now: NOW });
  assert.deepEqual(slots.map(iso), ['2026-08-10T04:00:00.000Z', '2026-08-10T04:30:00.000Z', '2026-08-10T05:00:00.000Z']);
});

test('buffers expand the occupied window so an adjacent busy block blocks the next slot', () => {
  // 30-min buffer after; busy 09:30-10:00 IST should also block the 09:00 slot (ends 09:30, +30 buffer => 10:00).
  const service = svc({ buffer_after_minutes: 30 });
  const busy = [{ start: zonedWallToUtc(2026, 8, 10, 9, 30, 'Asia/Kolkata'), end: zonedWallToUtc(2026, 8, 10, 10, 0, 'Asia/Kolkata') }];
  const slots = consultantSlotStarts({ service, consultant: mondayConsultant(), from: rangeFrom, to: rangeTo, busy, now: NOW });
  assert.ok(!slots.map(iso).includes('2026-08-10T03:30:00.000Z'), '09:00 slot should be blocked by buffer');
});

test('minimum notice excludes slots too close to now', () => {
  // now = 00:00 UTC = 05:30 IST. With 6h notice, earliest allowed = 06:00 UTC = 11:30 IST -> no Mon 9-11 slots.
  const service = svc({ minimum_notice_minutes: 6 * 60 });
  const slots = consultantSlotStarts({ service, consultant: mondayConsultant(), from: rangeFrom, to: rangeTo, busy: [], now: NOW });
  assert.equal(slots.length, 0);
});

test('booking horizon excludes slots beyond the window', () => {
  // Consultant works only Thursday (2026-08-13, ~3 days after the Monday "now").
  const consultant = { time_zone: 'Asia/Kolkata', working_hours: { '4': [['09:00', '10:00']] } };
  const to = iso(NOW + 10 * 86400000);
  const near = consultantSlotStarts({ service: svc({ booking_horizon_days: 2 }), consultant, from: rangeFrom, to, busy: [], now: NOW });
  assert.equal(near.length, 0, 'Thursday is beyond a 2-day horizon');
  const far = consultantSlotStarts({ service: svc({ booking_horizon_days: 30 }), consultant, from: rangeFrom, to, busy: [], now: NOW });
  assert.ok(far.length > 0, 'Thursday is within a 30-day horizon');
});

test('a day with no working hours yields no slots', () => {
  // Tuesday only hours, but the range Mon..Thu still should skip Mon/Wed/Thu with no windows.
  const consultant = { time_zone: 'Asia/Kolkata', working_hours: { '2': [['09:00', '10:00']] } };
  const slots = consultantSlotStarts({ service: svc(), consultant, from: rangeFrom, to: iso(NOW + 3 * 86400000), busy: [], now: NOW });
  // Only Tuesday 2026-08-11 09:00,09:30 IST => 03:30, 04:00 UTC
  assert.deepEqual(slots.map(iso), ['2026-08-11T03:30:00.000Z', '2026-08-11T04:00:00.000Z']);
});

test('duration longer than the window yields no slot', () => {
  const service = svc({ duration_minutes: 180 }); // 3h into a 2h window
  const slots = consultantSlotStarts({ service, consultant: mondayConsultant(), from: rangeFrom, to: rangeTo, busy: [], now: NOW });
  assert.equal(slots.length, 0);
});

test('PII encryption round-trips and ciphertext is not the plaintext', () => {
  const stored = { visitor_name: 'Asha', visitor_email: encrypt('asha@example.com'), visitor_phone: encrypt('9876543210'), notes: encrypt('needs GST help') };
  assert.notEqual(stored.visitor_email, 'asha@example.com'); // stored encrypted
  assert.ok(stored.visitor_phone && stored.visitor_phone.length > 20);
  const clear = decryptContacts(stored);
  assert.equal(clear.visitor_email, 'asha@example.com');
  assert.equal(clear.visitor_phone, '9876543210');
  assert.equal(clear.notes, 'needs GST help');
  assert.equal(clear.visitor_name, 'Asha'); // name left in clear
});

test('encrypt/decrypt handle empty values as null', () => {
  assert.equal(encrypt(''), null);
  assert.equal(encrypt(null), null);
  assert.equal(decryptContacts({ visitor_email: null }).visitor_email, null);
});

test('email adapter defaults to mock (no SMTP configured) and skips with no recipient', async () => {
  assert.equal(isConfigured(), false, 'mock by default in the test env (no SMTP_* set)');
  assert.deepEqual(await sendEmail({ to: '', subject: 's', html: 'h', text: 't' }), { skipped: true, reason: 'no_recipient' });
  const r = await sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
  assert.equal(r.mode, 'mock');
});

test('renderEmailHtml escapes content and includes a Meet button when given a url', () => {
  const html = renderEmailHtml({ heading: 'Hi <script>', intro: 'x', rows: [['Service', 'A & B']], meetUrl: 'https://meet.google.com/abc' });
  assert.ok(html.includes('Hi &lt;script&gt;'), 'heading is escaped');
  assert.ok(html.includes('A &amp; B'), 'row value is escaped');
  assert.ok(html.includes('https://meet.google.com/abc'), 'meet link present');
  const noBtn = renderEmailHtml({ heading: 'H', rows: [] });
  assert.ok(!noBtn.includes('Join Google Meet'), 'no button without a url');
});

test('normalizePhone: 10-digit gets +91, spacing stripped, junk => null', () => {
  assert.equal(normalizePhone('9876543210'), '919876543210');
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizePhone('919876543210'), '919876543210');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone(null), null);
});
