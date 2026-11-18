// FEATURE (b): AUTO FOLLOW-UPS — runs inside the eprchat backend.
// MUST bootstrap instance secrets FIRST (before anything loads util/crypto),
// otherwise the encrypted WhatsApp access token can't be decrypted. Mirrors index.js.
require('../util/instanceSecrets').bootstrapSecrets();

const pool = require('../db');
const { resolveAccount, insertPendingRow, markSent, markFailed } = require('../services/messageSender');
const { sendTemplate } = require('../integrations/metaSend');

const DRY_RUN = process.env.FOLLOWUP_DRY_RUN === '1';
const LANG = 'en';
const MAX_PER_RUN = 200;
const QUIET_START = 21, QUIET_END = 9; // IST — no live sends 9pm–9am

const SEGMENT_MAP = {
  Importers: ['importer_day1__', 'importer_day2', 'importer_offer'],
  Recycler:  ['recycler_day1',  'recycler_day2_', 'recycler_offer'],
  // LMPC segment tags (see setup_lmpc_lead_fields.sql). Template names below
  // are the naming convention only — each must still be created and Meta-approved
  // in Templates before these sends will succeed; until then the send just fails
  // and gets logged, same as any other unapproved template.
  'LMPC General':      ['lmpc_general_day1', 'lmpc_general_day3', 'lmpc_general_day7'],
  'LMPC Importer':     ['lmpc_importer_day1', 'lmpc_importer_day3', 'lmpc_importer_day7'],
  'LMPC Manufacturer': ['lmpc_manufacturer_day1', 'lmpc_manufacturer_day3', 'lmpc_manufacturer_day7'],
  'LMPC Label Review': ['lmpc_label_day1', 'lmpc_label_day3', 'lmpc_label_day7'],
};
const STEP_HOURS = [24, 72, 168];

function inQuietHours() {
  const h = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  return QUIET_START > QUIET_END ? (h >= QUIET_START || h < QUIET_END) : (h >= QUIET_START && h < QUIET_END);
}

function pickSegment(tags) {
  if (!Array.isArray(tags)) return null;
  const names = tags.map((t) => (t && t.name ? String(t.name) : '')).filter(Boolean);
  for (const key of Object.keys(SEGMENT_MAP)) if (names.includes(key)) return key;
  return null;
}

async function findColdLeads() {
  const { rows } = await pool.query(`
    WITH last_msg AS (
      SELECT DISTINCT ON (wa_number, contact_number)
             wa_number, contact_number, direction, timestamp AS ts
      FROM coexistence.chat_history
      ORDER BY wa_number, contact_number, timestamp DESC
    )
    SELECT ct.id, ct.name, ct.wa_number, ct.contact_number AS phone, ct.tags,
           EXTRACT(EPOCH FROM (now() - lm.ts)) / 3600 AS hours_since,
           COALESCE(fl.max_step, 0) AS last_step,
           fl.hours_since_followup
    FROM last_msg lm
    JOIN coexistence.contacts ct
      ON ct.wa_number = lm.wa_number AND ct.contact_number = lm.contact_number
    LEFT JOIN (
      SELECT contact_id, MAX(step) AS max_step,
             EXTRACT(EPOCH FROM (now() - MAX(sent_at))) / 3600 AS hours_since_followup
      FROM coexistence.follow_up_logs GROUP BY contact_id
    ) fl ON fl.contact_id = ct.id
    WHERE lm.direction = 'incoming'
      AND lm.ts < now() - INTERVAL '24 hours'
    LIMIT ${MAX_PER_RUN};
  `);
  return rows;
}

function nextStep(lead) {
  const last = Number(lead.last_step) || 0;
  if (last >= STEP_HOURS.length) return null;
  if (last === 0) return lead.hours_since >= STEP_HOURS[0] ? 1 : null;
  const gapHours = STEP_HOURS[last] - STEP_HOURS[last - 1];
  const since = lead.hours_since_followup;
  return since != null && since >= gapHours ? last + 1 : null;
}

async function alreadyLogged(contactId, step) {
  const { rows } = await pool.query(
    'SELECT 1 FROM coexistence.follow_up_logs WHERE contact_id=$1 AND step=$2', [contactId, step]);
  return rows.length > 0;
}
async function logSent(contactId, step, tpl) {
  await pool.query(
    `INSERT INTO coexistence.follow_up_logs (contact_id, step, template_name, sent_at)
     VALUES ($1,$2,$3,now()) ON CONFLICT (contact_id, step) DO NOTHING`, [contactId, step, tpl]);
}

async function run() {
  if (inQuietHours() && !DRY_RUN) { console.log('[followups] quiet hours — skipping.'); return; }
  const leads = await findColdLeads();
  console.log(`[followups] ${leads.length} cold leads; DRY_RUN=${DRY_RUN}`);
  let sent = 0, skipped = 0;

  for (const lead of leads) {
    const seg = pickSegment(lead.tags);
    if (!seg) { skipped++; console.log(`[followups] skip contact ${lead.id} (no segment tag)`); continue; }
    const step = nextStep(lead);
    if (!step) continue;
    if (await alreadyLogged(lead.id, step)) continue;

    const templateName = SEGMENT_MAP[seg][step - 1];
    const name = (lead.name && lead.name.trim()) || 'there';
    const to = String(lead.phone).replace(/\D/g, '');

    if (DRY_RUN) {
      console.log(`[DRY] contact ${lead.id} ${to} seg=${seg} step=${step} -> ${templateName} (name="${name}")`);
      sent++; continue;
    }

    try {
      const { account, error } = await resolveAccount({ fromPhoneNumber: lead.wa_number });
      if (error) { console.error(`[followups] contact ${lead.id}: ${error}`); continue; }
      const localId = await insertPendingRow({
        account, toNumber: to, messageType: 'template',
        messageBody: `[follow-up: ${templateName}]`,
        templateMeta: { name: templateName, language: LANG },
      });
      const components = [{ type: 'body', parameters: [{ type: 'text', text: name }] }];
      const result = await sendTemplate({
        accessToken: account.accessToken, phoneNumberId: account.phoneNumberId,
        to, templateName, languageCode: LANG, components,
      });
      const wamid = result?.messages?.[0]?.id;
      if (wamid) await markSent(localId, wamid); else await markFailed(localId, 'no wamid returned');
      await logSent(lead.id, step, templateName);
      sent++;
      console.log(`[followups] sent ${templateName} to ${to} (${wamid})`);
    } catch (e) {
      console.error(`[followups] contact ${lead.id} send failed: ${e.message}`);
    }
  }
  console.log(`[followups] done. sent=${sent} skipped=${skipped}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
