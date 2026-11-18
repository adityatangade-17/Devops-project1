// Outbound campaign engine — the Phase-2 proactive agents that message customers
// who did NOT just write in: Recovery (stalled leads), Reactivation (aged
// database), Collection (pending payments).
//
// Everything here is built to be Meta-ban-safe (see migration 069):
//   * DISABLED by default — only enabled campaigns run.
//   * TEMPLATE-GATED — a campaign with no template_name is skipped; we never
//     free-text a business-initiated message.
//   * RATE-LIMITED — per-run cap, per-day cap, and a per-CONTACT minimum gap that
//     spans ALL campaign kinds (a person can't get recovery + reactivation back
//     to back).
//   * QUIET-HOURS — no sends in the configured IST night window.
//   * OPT-OUT AWARE — contacts.marketing_opted_out permanently excludes a person.
//   * SELF-HEALING — aborts a run after repeated send failures (usually a
//     template/param mismatch) instead of burning the daily cap on rejects.
//
// Driven by index.js (setInterval on Docker) and /api/cron/outbound-campaigns.

const pool = require('../db');
const { normalizePhone } = require('../engine/contactMutations');
const { resolveAccount, insertPendingRow, markSent, markFailed } = require('./messageSender');
const { sendTemplate } = require('../integrations/metaSend');
const { decryptContacts } = require('./bookingCrypto');

const ABORT_AFTER_FAILURES = 3;

// IST hour now (UTC+5:30).
function istHour() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
}
// Pure predicate (testable): is hour `h` inside the [start,end) quiet window?
// Handles overnight windows (start > end, e.g. 21→9).
function hourInQuietWindow(h, startHour, endHour) {
  return startHour > endHour ? (h >= startHour || h < endHour) : (h >= startHour && h < endHour);
}
function inQuietHours(startHour, endHour) {
  return hourInQuietWindow(istHour(), startHour, endHour);
}

// Count today's successful sends for a kind (per-day cap) — uses a rolling 24h
// window rather than calendar day so it's timezone-agnostic and simple.
async function sentInLastDay(kind) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM coexistence.outbound_sends
      WHERE kind = $1 AND status = 'sent' AND created_at > NOW() - INTERVAL '24 hours'`,
    [kind],
  );
  return rows[0]?.c || 0;
}

// Recovery / Reactivation candidates come straight from chat history + contacts,
// with opt-out and the cross-kind minimum gap enforced in SQL.
async function fetchEngagementAudience({ kind, staleDays, minGapDays, audienceTag, limit }) {
  const requireReplied = kind === 'recovery'; // recovery = we engaged, then silence
  // limit is always $3; the optional audience tag is $4.
  const tagClause = audienceTag
    ? `AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(ct.tags,'[]'::jsonb)) t WHERE t->>'name' = $4)`
    : '';
  const params = [staleDays, minGapDays, limit];
  if (audienceTag) params.push(audienceTag);

  const { rows } = await pool.query(
    `WITH last_activity AS (
       SELECT wa_number, contact_number,
              MAX(timestamp) AS last_ts,
              BOOL_OR(direction = 'outgoing') AS we_replied,
              BOOL_OR(direction = 'incoming') AS they_wrote
         FROM coexistence.chat_history
        GROUP BY wa_number, contact_number
     )
     SELECT la.wa_number, la.contact_number, ct.name, ct.profile_name
       FROM last_activity la
       JOIN coexistence.contacts ct
         ON ct.wa_number = la.wa_number AND ct.contact_number = la.contact_number
      WHERE la.they_wrote
        ${requireReplied ? 'AND la.we_replied' : ''}
        AND la.last_ts < NOW() - ($1::int * INTERVAL '1 day')
        AND COALESCE(ct.marketing_opted_out, FALSE) = FALSE
        ${tagClause}
        AND NOT EXISTS (
          SELECT 1 FROM coexistence.outbound_sends os
           WHERE os.contact_number = la.contact_number
             AND os.status = 'sent'
             AND os.created_at > NOW() - ($2::int * INTERVAL '1 day'))
      ORDER BY la.last_ts DESC
      LIMIT $3`,
    params,
  );
  return rows.map(r => ({
    waNumber: r.wa_number,
    contactNumber: r.contact_number,
    name: (r.name || r.profile_name || '').trim() || 'there',
    bookingId: null,
  }));
}

// Collection candidates come from bookings with money outstanding. visitor_phone
// is encrypted at rest, so opt-out + min-gap are checked per row in JS after
// decrypting (we can't join on the ciphertext).
async function fetchCollectionAudience({ staleDays, limit }) {
  const { rows } = await pool.query(
    `SELECT b.id AS booking_id, b.visitor_phone, b.visitor_name,
            b.amount_minor, b.currency, s.name AS service_name
       FROM coexistence.bookings b
       JOIN coexistence.booking_services s ON s.id = b.service_id
      WHERE b.payment_status IN ('due','pending','failed')
        AND b.created_at < NOW() - ($1::int * INTERVAL '1 day')
        AND b.created_at > NOW() - INTERVAL '120 days'
      ORDER BY b.created_at DESC
      LIMIT $2`,
    [staleDays, limit * 3], // over-fetch; many will be filtered by opt-out/min-gap
  );
  const out = [];
  for (const b of rows) {
    const dec = decryptContacts(b);
    const phone = normalizePhone(dec.visitor_phone || '');
    if (!phone) continue;
    out.push({
      waNumber: null,
      contactNumber: phone,
      name: (dec.visitor_name || '').trim() || 'there',
      bookingId: b.booking_id,
      amountMinor: b.amount_minor,
      currency: b.currency || 'INR',
      serviceName: b.service_name,
    });
  }
  return out;
}

// Has this contact been messaged by ANY campaign within the gap window?
async function contactedRecently(contactNumber, minGapDays) {
  const { rows } = await pool.query(
    `SELECT 1 FROM coexistence.outbound_sends
      WHERE contact_number = $1 AND status = 'sent'
        AND created_at > NOW() - ($2::int * INTERVAL '1 day') LIMIT 1`,
    [contactNumber, minGapDays],
  );
  return rows.length > 0;
}

async function isOptedOut(contactNumber) {
  const { rows } = await pool.query(
    `SELECT marketing_opted_out FROM coexistence.contacts
      WHERE contact_number = $1 AND COALESCE(marketing_opted_out, FALSE) = TRUE LIMIT 1`,
    [contactNumber],
  );
  return rows.length > 0;
}

async function logSend({ kind, waNumber, contactNumber, templateName, bookingId, status, reason }) {
  await pool.query(
    `INSERT INTO coexistence.outbound_sends
       (kind, wa_number, contact_number, template_name, booking_id, status, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [kind, waNumber || null, contactNumber, templateName || null, bookingId || null, status, reason || null],
  );
}

// Build the WhatsApp template body params for a candidate. Recovery/reactivation
// templates take {{1}} = name; collection takes {{1}} = name, {{2}} = amount.
function buildComponents(kind, cand) {
  const params = [{ type: 'text', text: cand.name }];
  if (kind === 'collection') {
    const amt = Number(cand.amountMinor || 0) / 100;
    const pretty = `${cand.currency === 'INR' ? '₹' : ''}${amt.toLocaleString('en-IN')}`;
    params.push({ type: 'text', text: pretty });
  }
  return [{ type: 'body', parameters: params }];
}

async function runCampaign(c) {
  if (!c.template_name) return { skipped: 'no template configured' };
  if (inQuietHours(c.quiet_start_hour, c.quiet_end_hour)) return { skipped: 'quiet hours' };
  if (c.kind === 'collection' && !c.wa_account_id) return { skipped: 'no sending number configured' };

  const sentToday = await sentInLastDay(c.kind);
  const remainingDay = Math.max(0, c.max_per_day - sentToday);
  if (remainingDay === 0) return { skipped: 'daily cap reached', sentToday };
  const cap = Math.min(c.max_per_run, remainingDay);

  const audience = c.kind === 'collection'
    ? await fetchCollectionAudience({ staleDays: c.stale_days, limit: cap })
    : await fetchEngagementAudience({
        kind: c.kind, staleDays: c.stale_days, minGapDays: c.min_gap_days,
        audienceTag: c.audience_tag || null, limit: cap * 3,
      });

  let sent = 0, failed = 0, skipped = 0, consecutiveFailures = 0;

  for (const cand of audience) {
    if (sent >= cap) break;

    // Cross-kind opt-out + minimum gap (collection audience isn't pre-filtered).
    if (await isOptedOut(cand.contactNumber)) { skipped++; continue; }
    if (await contactedRecently(cand.contactNumber, c.min_gap_days)) { skipped++; continue; }

    // Resolve the sending account.
    const acctQuery = c.kind === 'collection'
      ? { accountId: c.wa_account_id }
      : { fromPhoneNumber: cand.waNumber };
    const { account, error } = await resolveAccount(acctQuery);
    if (error || !account) {
      await logSend({ kind: c.kind, contactNumber: cand.contactNumber, templateName: c.template_name, bookingId: cand.bookingId, status: 'failed', reason: error || 'no account' });
      failed++; consecutiveFailures++;
      if (consecutiveFailures >= ABORT_AFTER_FAILURES) break;
      continue;
    }

    const to = cand.contactNumber;
    const waNumber = normalizePhone(account.displayPhoneNumber || cand.waNumber || '');
    try {
      const localId = await insertPendingRow({
        account, toNumber: to, messageType: 'template',
        messageBody: `[${c.kind}: ${c.template_name}]`,
        templateMeta: { name: c.template_name, language: c.template_language },
      });
      const result = await sendTemplate({
        accessToken: account.accessToken, phoneNumberId: account.phoneNumberId,
        to, templateName: c.template_name, languageCode: c.template_language,
        components: buildComponents(c.kind, cand),
      });
      const wamid = result?.messages?.[0]?.id;
      if (wamid) { await markSent(localId, wamid); } else { await markFailed(localId, 'no wamid returned'); }
      await logSend({ kind: c.kind, waNumber, contactNumber: to, templateName: c.template_name, bookingId: cand.bookingId, status: wamid ? 'sent' : 'failed', reason: wamid ? null : 'no wamid' });
      if (wamid) { sent++; consecutiveFailures = 0; } else { failed++; consecutiveFailures++; }
    } catch (e) {
      await logSend({ kind: c.kind, waNumber, contactNumber: to, templateName: c.template_name, bookingId: cand.bookingId, status: 'failed', reason: e.message });
      failed++; consecutiveFailures++;
    }
    if (consecutiveFailures >= ABORT_AFTER_FAILURES) break;
  }

  const summary = { sent, failed, skipped, cap };
  if (consecutiveFailures >= ABORT_AFTER_FAILURES) summary.aborted = 'repeated send failures — check the template name/params';
  if (sent > 0 || failed > 0) console.log(`[outbound:${c.kind}] sent=${sent} failed=${failed} skipped=${skipped}`);
  return summary;
}

async function runOutboundCampaigns() {
  const { rows: campaigns } = await pool.query(
    `SELECT * FROM coexistence.outbound_campaigns WHERE enabled = TRUE ORDER BY kind`,
  );
  const result = {};
  for (const c of campaigns) {
    try { result[c.kind] = await runCampaign(c); }
    catch (e) { console.error(`[outbound:${c.kind}] error:`, e.message); result[c.kind] = { error: e.message }; }
  }
  return result;
}

module.exports = {
  runOutboundCampaigns,
  runCampaign,
  inQuietHours,
  // exported for tests
  hourInQuietWindow,
  buildComponents,
};
