const pool = require('../db');

const STOP_CATEGORY_ID = 'system-compliance';
const STOP_TAG_ID = 'system-stop';
const STOP_TAG = { id: STOP_TAG_ID, name: 'STOP', color: '#DC2626', category_id: STOP_CATEGORY_ID };
const OPT_OUT_KEYWORDS = new Set([
  'stop', 'stop promotions', 'unsubscribe', 'opt out', 'optout', 'opt-out',
  'remove me', 'unsub', 'band karo', 'band karein', 'mat bhejo',
]);

function normalizePhone(value) {
  return value ? String(value).replace(/\D/g, '') : '';
}

function isStopTag(tag) {
  return tag && (String(tag.id || '') === STOP_TAG_ID || String(tag.name || '').trim().toLowerCase() === 'stop');
}

function isOptOutText(body) {
  if (!body) return false;
  const normalized = String(body).trim().toLowerCase().replace(/[.!,;:]+$/g, '');
  return OPT_OUT_KEYWORDS.has(normalized);
}

class OptOutBlockedError extends Error {
  constructor() {
    super('Outbound message blocked: this contact has opted out.');
    this.name = 'OptOutBlockedError';
    this.code = 'CONTACT_OPTED_OUT';
    this.skipRetry = true;
  }
}

async function ensureStopTag(client = pool) {
  await client.query(
    `INSERT INTO coexistence.categories (id, name, description)
     VALUES ($1, 'Compliance', 'System-managed compliance and consent tags')
     ON CONFLICT (id) DO NOTHING`,
    [STOP_CATEGORY_ID],
  );
  await client.query(
    `INSERT INTO coexistence.tags (id, name, color, category_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [STOP_TAG.id, STOP_TAG.name, STOP_TAG.color, STOP_TAG.category_id],
  );
  return STOP_TAG;
}

// The existing marketing_opted_out field is the single, durable STOP source of
// truth. The JSONB tag is retained for operator visibility and filtering.
async function markContactOptedOut({ waNumber, contactNumber, profileName = null, sourceMessageId = null, client = pool }) {
  const wa = normalizePhone(waNumber);
  const contact = normalizePhone(contactNumber);
  if (!wa || !contact) throw new Error('markContactOptedOut: waNumber and contactNumber are required');

  const tag = await ensureStopTag(client);
  await client.query(
    `INSERT INTO coexistence.contacts
       (wa_number, contact_number, profile_name, tags, marketing_opted_out, marketing_opted_out_at, ai_paused, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, TRUE, NOW(), TRUE, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE SET
       profile_name = COALESCE(coexistence.contacts.profile_name, EXCLUDED.profile_name),
       tags = CASE
         WHEN EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(coexistence.contacts.tags, '[]'::jsonb)) tag_ref
           WHERE tag_ref->>'id' = $5 OR LOWER(COALESCE(tag_ref->>'name', '')) = 'stop'
         ) THEN COALESCE(coexistence.contacts.tags, '[]'::jsonb)
         ELSE COALESCE(coexistence.contacts.tags, '[]'::jsonb) || EXCLUDED.tags
       END,
       marketing_opted_out = TRUE,
       marketing_opted_out_at = COALESCE(coexistence.contacts.marketing_opted_out_at, NOW()),
       ai_paused = TRUE,
       updated_at = NOW()`,
    [wa, contact, profileName || null, JSON.stringify([tag]), tag.id],
  );

  // Keep execution history, but cancel any work that could still send later.
  await client.query(
    `UPDATE coexistence.automation_executions
        SET status = 'cancelled', completed_at = NOW(),
            error_message = COALESCE(error_message, 'Cancelled because contact opted out')
      WHERE wa_number = $1 AND contact_number = $2 AND status IN ('running', 'paused')`,
    [wa, contact],
  );
  return { optedOut: true, tag, sourceMessageId: sourceMessageId || null };
}

async function isContactOptedOut({ waNumber, contactNumber, client = pool }) {
  const wa = normalizePhone(waNumber);
  const contact = normalizePhone(contactNumber);
  if (!wa || !contact) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM coexistence.contacts
      WHERE wa_number = $1 AND contact_number = $2
        AND COALESCE(marketing_opted_out, FALSE) = TRUE
      LIMIT 1`,
    [wa, contact],
  );
  return rows.length > 0;
}

// Unknown recipients are allowed: an opt-out is only actionable when the
// account/recipient pair resolves to an existing opted-out contact.
async function assertMetaSendAllowed({ phoneNumberId, to, client = pool }) {
  const contact = normalizePhone(to);
  if (!phoneNumberId || !contact) return { allowed: true };
  const { rows } = await client.query(
    `SELECT 1
       FROM coexistence.contacts c
       JOIN coexistence.whatsapp_accounts a
         ON regexp_replace(COALESCE(a.display_phone_number, ''), '\\D', '', 'g') = c.wa_number
      WHERE a.phone_number_id = $1
        AND c.contact_number = $2
        AND COALESCE(c.marketing_opted_out, FALSE) = TRUE
      LIMIT 1`,
    [phoneNumberId, contact],
  );
  if (rows.length > 0) throw new OptOutBlockedError();
  return { allowed: true };
}

module.exports = {
  STOP_TAG,
  OptOutBlockedError,
  normalizePhone,
  isStopTag,
  isOptOutText,
  ensureStopTag,
  markContactOptedOut,
  isContactOptedOut,
  assertMetaSendAllowed,
};
