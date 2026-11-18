// Shared contact-mutation primitives used by the AI agent's built-in tools
// (backend/src/engine/agentEngine.js) — a live conversation needs to write
// custom fields / tags / trigger a human handover mid-chat, not just via a
// separate keyword automation. Mirrors the equivalent inline logic in
// automationEngine.js's executeActionNode.

const pool = require('../db');

function normalizePhone(s) {
  if (!s) return s;
  return String(s).replace(/\D/g, '');
}

async function resolveFieldId(fieldName) {
  const { rows } = await pool.query(
    `SELECT id, name FROM coexistence.contact_field_definitions WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [String(fieldName || '').trim()],
  );
  return rows[0] || null;
}

async function setCustomField({ waNumber, contactNumber, fieldName, value }) {
  const wa = normalizePhone(waNumber);
  if (!wa || !contactNumber) throw new Error('setCustomField: waNumber and contactNumber are required');
  const field = await resolveFieldId(fieldName);
  if (!field) return { ok: false, error: `custom field "${fieldName}" not found` };
  const { rows: cur } = await pool.query(
    `SELECT custom_fields FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
    [wa, contactNumber],
  );
  const cf = { ...((cur[0] && cur[0].custom_fields) || {}) };
  cf[field.id] = value;
  await pool.query(
    `INSERT INTO coexistence.contacts (wa_number, contact_number, custom_fields, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE
       SET custom_fields = EXCLUDED.custom_fields, updated_at = NOW()`,
    [wa, contactNumber, JSON.stringify(cf)],
  );
  return { ok: true, field: field.name, value };
}

// value: "+15" / "-10" (delta) or a bare number (absolute). Missing/invalid
// current score treated as 0. Field must be named "Lead Score" (or pass a
// different name) and exist as a 'number' custom field.
async function updateLeadScore({ waNumber, contactNumber, delta, fieldName = 'Lead Score' }) {
  const wa = normalizePhone(waNumber);
  if (!wa || !contactNumber) throw new Error('updateLeadScore: waNumber and contactNumber are required');
  const field = await resolveFieldId(fieldName);
  if (!field) return { ok: false, error: `custom field "${fieldName}" not found` };
  const { rows: cur } = await pool.query(
    `SELECT custom_fields FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
    [wa, contactNumber],
  );
  const cf = { ...((cur[0] && cur[0].custom_fields) || {}) };
  const currentScore = Number(cf[field.id]);
  const base = Number.isFinite(currentScore) ? currentScore : 0;
  const newScore = base + delta;
  cf[field.id] = newScore;
  await pool.query(
    `INSERT INTO coexistence.contacts (wa_number, contact_number, custom_fields, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE
       SET custom_fields = EXCLUDED.custom_fields, updated_at = NOW()`,
    [wa, contactNumber, JSON.stringify(cf)],
  );
  return { ok: true, field: field.name, previousScore: base, delta, newScore };
}

async function addTag({ waNumber, contactNumber, tagName }) {
  const wa = normalizePhone(waNumber);
  if (!wa || !contactNumber) throw new Error('addTag: waNumber and contactNumber are required');
  const name = String(tagName || '').trim();
  if (!name) return { ok: false, error: 'no tag name given' };
  const { rows: tagRows } = await pool.query(
    `SELECT id, name, color, category_id FROM coexistence.tags WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name],
  );
  if (tagRows.length === 0) return { ok: false, error: `tag "${name}" not found` };
  const tag = tagRows[0];
  const { rows: cur } = await pool.query(
    `SELECT tags FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
    [wa, contactNumber],
  );
  const existing = (cur[0] && cur[0].tags) || [];
  const already = existing.some(t => t && (t.id === tag.id || String(t.name || '').toLowerCase() === tag.name.toLowerCase()));
  const newTags = already ? existing : [...existing, { id: tag.id, name: tag.name, color: tag.color, category_id: tag.category_id }];
  await pool.query(
    `INSERT INTO coexistence.contacts (wa_number, contact_number, tags, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE
       SET tags = EXCLUDED.tags, updated_at = NOW()`,
    [wa, contactNumber, JSON.stringify(newTags)],
  );
  return { ok: true, tag: tag.name, applied: !already };
}

// Best-effort — a human still needs to react even if the WhatsApp notify send
// fails (no open session window, no number configured, etc.), so failures here
// are reported but never thrown.
async function notifyConsultant({ userId, waAccountId, fromPhoneNumber, contactNumber, contactSummary }) {
  try {
    const { rows } = await pool.query(
      `SELECT display_name, notify_wa_number FROM coexistence.forgecrm_users WHERE id = $1`,
      [userId],
    );
    const user = rows[0];
    if (!user || !user.notify_wa_number) return { ok: false, error: 'consultant has no notify_wa_number configured' };
    const { resolveAccount, insertPendingRow } = require('../services/messageSender');
    const { enqueueSend } = require('../queue/sendQueue');
    const { account, error: accErr } = await resolveAccount({ accountId: waAccountId, fromPhoneNumber });
    if (accErr || !account) return { ok: false, error: accErr || 'no WhatsApp account to send the notification from' };
    const body = `New handover: ${contactSummary || `contact ${contactNumber}`} needs your review.`;
    const to = normalizePhone(user.notify_wa_number);
    const localId = await insertPendingRow({ account, toNumber: to, messageType: 'text', messageBody: body });
    await enqueueSend({ kind: 'text', accountId: account.id, to, localMessageId: localId, payload: { body } });
    return { ok: true, notified: user.display_name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Pauses the AI on this contact, assigns a consultant, applies the "Human
// Handover" tag if it exists, and best-effort notifies the consultant.
async function triggerHandoff({ waNumber, waAccountId, fromPhoneNumber, contactNumber, contactName, reason, assignedUserId, agentId }) {
  const wa = normalizePhone(waNumber);
  if (!wa || !contactNumber) throw new Error('triggerHandoff: waNumber and contactNumber are required');

  await pool.query(
    `INSERT INTO coexistence.contacts (wa_number, contact_number, ai_paused, updated_at)
     VALUES ($1, $2, TRUE, NOW())
     ON CONFLICT (wa_number, contact_number) DO UPDATE
       SET ai_paused = TRUE, updated_at = NOW()`,
    [wa, contactNumber],
  );

  let userId = assignedUserId || null;
  if (!userId && agentId) {
    const { rows } = await pool.query(
      `SELECT default_consultant_user_id FROM coexistence.agents WHERE id = $1`,
      [agentId],
    );
    userId = rows[0]?.default_consultant_user_id || null;
  }
  if (!userId) {
    const { rows } = await pool.query(
      `SELECT u.id FROM coexistence.forgecrm_users u
         JOIN coexistence.user_wa_assignments uwa ON uwa.user_id = u.id
        WHERE uwa.wa_number = $1 AND u.is_active = TRUE AND u.role IN ('admin','bda_sales')
        ORDER BY u.id LIMIT 1`,
      [wa],
    );
    userId = rows[0]?.id || null;
  }
  // Last-resort fallback: nobody is assigned to this WhatsApp number and the
  // agent has no default consultant — route to any active admin rather than
  // leaving the customer silently unassigned.
  if (!userId) {
    const { rows } = await pool.query(
      `SELECT id FROM coexistence.forgecrm_users
        WHERE is_active = TRUE AND role = 'admin'
        ORDER BY id LIMIT 1`,
    );
    userId = rows[0]?.id || null;
  }

  let assignResult = { ok: false, error: 'no consultant available to assign' };
  if (userId) {
    await pool.query(
      `INSERT INTO coexistence.contacts (wa_number, contact_number, assigned_user_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (wa_number, contact_number) DO UPDATE
         SET assigned_user_id = EXCLUDED.assigned_user_id, updated_at = NOW()`,
      [wa, contactNumber, userId],
    );
    assignResult = { ok: true, userId };
  }

  // Auto-task: give the assigned human a concrete follow-up item so a handed-over
  // chat never falls through the cracks. Best-effort — lazy require avoids any
  // module load-order cycle, and a failure here must not break the handoff.
  if (userId) {
    try {
      const { createTask } = require('../routes/tasks');
      await createTask({
        title: `Follow up with ${contactName || contactNumber}`,
        description: reason ? `Handover reason: ${reason}` : 'Conversation was handed over from the AI agent.',
        assignedUserId: userId,
        waNumber: wa,
        contactNumber,
        contactName: contactName || null,
        priority: 'high',
        source: 'handoff',
        agentId: agentId || null,
      });
    } catch (e) {
      console.error('[contactMutations] handoff task create failed:', e.message);
    }
  }

  const tagResult = await addTag({ waNumber: wa, contactNumber, tagName: 'Human Handover' });

  let notifyResult = { ok: false, error: 'no consultant assigned' };
  if (userId) {
    notifyResult = await notifyConsultant({
      userId,
      waAccountId,
      fromPhoneNumber,
      contactNumber,
      contactSummary: `${contactName || contactNumber}${reason ? ` — ${reason}` : ''}`,
    });
  }

  const consultant = userId ? await pool.query('SELECT display_name, notify_wa_number FROM coexistence.forgecrm_users WHERE id=$1', [userId]) : { rows: [] };

  // Audit log recording
  try {
    let kbId = null;
    if (agentId) {
      const { rows: aRows } = await pool.query('SELECT knowledge_base_id FROM coexistence.agents WHERE id=$1', [agentId]);
      kbId = aRows[0]?.knowledge_base_id || null;
    }
    await pool.query(
      `INSERT INTO coexistence.agent_handovers
         (agent_id, knowledge_base_id, wa_number, contact_number, assigned_user_id, reason, customer_message_sent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [agentId || null, kbId, wa, contactNumber, userId || null, reason || null, null]
    );
  } catch (e) {
    console.error('[contactMutations] audit log failed:', e.message);
  }

  return {
    paused: true,
    assign: assignResult,
    tag: tagResult,
    notify: notifyResult,
    consultantName: consultant.rows[0]?.display_name || null,
    consultantPhone: consultant.rows[0]?.notify_wa_number || null,
  };
}

async function resumeAi({ waNumber, contactNumber }) {
  const wa = normalizePhone(waNumber);
  if (!wa || !contactNumber) throw new Error('resumeAi: waNumber and contactNumber are required');
  await pool.query(
    `UPDATE coexistence.contacts SET ai_paused = FALSE, updated_at = NOW()
      WHERE wa_number = $1 AND contact_number = $2`,
    [wa, contactNumber]
  );
  return { ok: true, paused: false };
}

module.exports = {
  normalizePhone,
  resolveFieldId,
  setCustomField,
  updateLeadScore,
  addTag,
  notifyConsultant,
  triggerHandoff,
  resumeAi,
};
