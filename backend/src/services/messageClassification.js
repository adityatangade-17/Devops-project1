const pool = require('../db');
const { normalizePhone, isOptOutText } = require('./optOut');

const AUTO_RESPONSE_CATEGORY_ID = 'system-conversation';
const AUTO_RESPONSE_TAG = {
  id: 'system-auto-response',
  name: 'Auto Response',
  color: '#D97706',
  category_id: AUTO_RESPONSE_CATEGORY_ID,
};

function classifyIncomingMessage({ messageType, messageBody }) {
  const text = String(messageBody || '').trim();
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  if (isOptOutText(text)) return { kind: 'STOP', confidence: 1, reason: 'recognized_opt_out_phrase' };
  if (!text || messageType !== 'text') return { kind: 'NORMAL_HUMAN', confidence: 0, reason: 'non_text_or_empty' };

  const signals = [];
  const add = (name, weight, pattern) => { if (pattern.test(normalized)) signals.push({ name, weight }); };
  add('explicit_automation', 4, /\b(?:this is an |an )?(?:automated|automatic|auto)[ -]?(?:reply|response|message)\b/);
  add('away_or_out_of_office', 4, /\b(?:out of (?:the )?office|away (?:from (?:the )?office)?|currently unavailable)\b/);
  add('business_hours', 2, /\b(?:business|working|office) hours?\b/);
  add('contact_acknowledgement', 2, /\b(?:thanks?|thank you) for contacting\b/);
  add('leave_message', 2, /\b(?:please )?leave (?:your )?message\b/);
  add('receipt_acknowledgement', 2, /\b(?:we have |we'?ve |your message has been )?(?:received|noted) (?:your )?message\b/);
  add('team_will_reply', 1, /\b(?:our team|we) (?:will|shall) (?:get back|respond|contact you)\b/);
  add('return_time', 1, /\b(?:will return|back on|respond within)\b/);

  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  if (score >= 4 && signals.length >= 1) {
    return { kind: 'AUTO_RESPONSE', confidence: Math.min(0.98, 0.55 + score * 0.08), reason: signals.map(s => s.name).join(',') };
  }

  const isQuestion = /\?$/.test(text) || /^(?:what|when|where|why|how|can|could|do|does|is|are|please (?:send|share|tell))/i.test(text);
  if (isQuestion) return { kind: 'CUSTOMER_QUESTION', confidence: 0.8, reason: 'question_form' };
  return { kind: 'NORMAL_HUMAN', confidence: 0.7, reason: 'no_auto_response_signals' };
}

async function ensureAutoResponseTag(client = pool) {
  await client.query(
    `INSERT INTO coexistence.categories (id, name, description)
     VALUES ($1, 'Conversation Status', 'System-managed conversation classification tags')
     ON CONFLICT (id) DO NOTHING`,
    [AUTO_RESPONSE_CATEGORY_ID],
  );
  await client.query(
    `INSERT INTO coexistence.tags (id, name, color, category_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [AUTO_RESPONSE_TAG.id, AUTO_RESPONSE_TAG.name, AUTO_RESPONSE_TAG.color, AUTO_RESPONSE_TAG.category_id],
  );
  return AUTO_RESPONSE_TAG;
}

async function markAutoResponse({ waNumber, contactNumber, profileName = null, classification, client = pool }) {
  const wa = normalizePhone(waNumber);
  const contact = normalizePhone(contactNumber);
  if (!wa || !contact) throw new Error('markAutoResponse: waNumber and contactNumber are required');
  const tag = await ensureAutoResponseTag(client);
  await client.query(
    `INSERT INTO coexistence.contacts
       (wa_number, contact_number, profile_name, tags, auto_response_detected, auto_response_detected_at, auto_response_reason, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, TRUE, NOW(), $5, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE SET
       profile_name = COALESCE(coexistence.contacts.profile_name, EXCLUDED.profile_name),
       tags = CASE
         WHEN EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(coexistence.contacts.tags, '[]'::jsonb)) tag_ref
            WHERE tag_ref->>'id' = $6 OR LOWER(COALESCE(tag_ref->>'name', '')) = 'auto response'
         ) THEN COALESCE(coexistence.contacts.tags, '[]'::jsonb)
         ELSE COALESCE(coexistence.contacts.tags, '[]'::jsonb) || EXCLUDED.tags
       END,
       auto_response_detected = TRUE,
       auto_response_detected_at = NOW(),
       auto_response_reason = EXCLUDED.auto_response_reason,
       updated_at = NOW()`,
    [wa, contact, profileName || null, JSON.stringify([tag]), classification?.reason || 'deterministic_message_signals', tag.id],
  );
  return { classified: true, tag, classification };
}

module.exports = {
  AUTO_RESPONSE_TAG,
  classifyIncomingMessage,
  ensureAutoResponseTag,
  markAutoResponse,
};
