// Availability / slot generation for the booking module.
//
// Pure, dependency-free time math (the backend ships no date library). All
// stored instants are UTC; consultant working hours are wall-clock local to the
// consultant's IANA time zone. We convert local wall-clock -> UTC using the
// zone's offset AT that instant (via Intl), so this is DST-correct even though
// the default zone (Asia/Kolkata) has no DST.

/** Milliseconds the given IANA zone is ahead of UTC at a specific UTC instant. */
function zoneOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  // 'en-US' can render midnight as hour "24" — normalise to 0.
  const hour = m.hour === '24' ? 0 : Number(m.hour);
  const asIfUtc = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), hour, Number(m.minute), Number(m.second));
  return asIfUtc - utcMs;
}

/** UTC Date for a wall-clock (Y-M-D H:M) in `timeZone`. */
function zonedWallToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  // One correction pass is enough away from the ~1h/yr DST seams; two is exact.
  let offset = zoneOffsetMs(guess, timeZone);
  offset = zoneOffsetMs(guess - offset, timeZone);
  return new Date(guess - offset);
}

/** The local Y-M-D + ISO weekday (1=Mon..7=Sun) for a UTC instant in a zone. */
function localDateParts(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const m = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) m[p.type] = p.value;
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[m.weekday];
  return { year: Number(m.year), month: Number(m.month), day: Number(m.day), weekday: wd };
}

function parseHhmm(s) {
  const [h, m] = String(s).split(':').map(n => parseInt(n, 10));
  return { h: h || 0, m: m || 0 };
}

/** True if [aStart,aEnd) overlaps [bStart,bEnd). All values are ms. */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Free slot START instants (UTC, ms) for ONE consultant of ONE service within
 * [from, to]. Buffers, minimum notice and the booking horizon are enforced here;
 * `busy` is the union of the consultant's external (Google) + internal
 * (bookings/holds) busy intervals as {start,end} Dates/ms.
 *
 * @returns {number[]} sorted, de-duplicated slot start times in ms
 */
function consultantSlotStarts({ service, consultant, from, to, busy, now = Date.now() }) {
  const tz = consultant.time_zone || 'Asia/Kolkata';
  const wh = consultant.working_hours || {};
  const durationMs = service.duration_minutes * 60000;
  const stepMs = (service.slot_granularity_minutes || service.duration_minutes) * 60000;
  const bufBefore = (service.buffer_before_minutes || 0) * 60000;
  const bufAfter = (service.buffer_after_minutes || 0) * 60000;
  const earliest = now + (service.minimum_notice_minutes || 0) * 60000;
  const horizon = now + (service.booking_horizon_days || 30) * 86400000;

  const rangeStart = Math.max(new Date(from).getTime(), now);
  const rangeEnd = Math.min(new Date(to).getTime(), horizon);
  if (rangeEnd <= rangeStart) return [];

  const busyMs = (busy || []).map(b => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));

  const out = [];
  // Walk local calendar days across the range. Start a day before to catch a
  // window that began the previous local day, and iterate until past rangeEnd.
  let cursor = rangeStart - 86400000;
  const seenDays = new Set();
  while (cursor <= rangeEnd + 86400000) {
    const { year, month, day, weekday } = localDateParts(cursor, tz);
    const dayKey = `${year}-${month}-${day}`;
    cursor += 86400000;
    if (seenDays.has(dayKey)) continue;
    seenDays.add(dayKey);

    const windows = wh[String(weekday)] || [];
    for (const [startStr, endStr] of windows) {
      const s = parseHhmm(startStr);
      const e = parseHhmm(endStr);
      const winStart = zonedWallToUtc(year, month, day, s.h, s.m, tz).getTime();
      const winEnd = zonedWallToUtc(year, month, day, e.h, e.m, tz).getTime();
      for (let t = winStart; t + durationMs <= winEnd + 1; t += stepMs) {
        const slotStart = t;
        const slotEnd = t + durationMs;
        if (slotStart < earliest) continue;
        if (slotStart < rangeStart || slotStart > rangeEnd) continue;
        // Occupied window includes buffers on either side.
        const occStart = slotStart - bufBefore;
        const occEnd = slotEnd + bufAfter;
        const clash = busyMs.some(b => overlaps(occStart, occEnd, b.start, b.end));
        if (!clash) out.push(slotStart);
      }
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

module.exports = {
  consultantSlotStarts,
  zonedWallToUtc,
  localDateParts,
  zoneOffsetMs,
  overlaps,
};
