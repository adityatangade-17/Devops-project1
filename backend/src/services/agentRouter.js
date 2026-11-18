// Agent router. Called from the webhook after evaluateTriggers() returns.
// Decides whether to hand an inbound message to the active agent for that
// WhatsApp account.
//
// Precedence (handled by the caller):
//   1. Paused automation execution awaiting a reply → resume that, skip agent.
//   2. Keyword automation fires on this message → run it, skip agent.
//   3. contacts.ai_paused (human handoff in progress) → skip agent entirely.
//   4. Otherwise → this router enqueues the agent run (if any agent is active
//      for the inbound WA number).

const pool = require('../db');
const { enqueueAgentRun } = require('../queue/agentQueue');
const {
  getInteractiveCandidateTexts,
  formatInteractiveInboundText,
} = require('../util/interactiveReply');
const { isContactOptedOut } = require('./optOut');

// Keyword matcher — mirrors automationEngine's matchesKeyword so the agent's
// keyword trigger behaves identically to a keyword automation's.
function normalizeText(t) { return (t || '').toLowerCase().trim(); }
function matchesKeyword(messageBody, keyword, matchType, caseSensitive) {
  if (!messageBody || !keyword) return false;
  const msg = caseSensitive ? String(messageBody).trim() : normalizeText(messageBody);
  const kw = caseSensitive ? String(keyword).trim() : normalizeText(keyword);
  if (!kw) return false;
  switch (matchType) {
    case 'contains': return msg.includes(kw);
    case 'starts': return msg.startsWith(kw);
    case 'exact':
    default: return msg === kw;
  }
}

function matchesIncomingRecord(record, keyword, matchType, caseSensitive) {
  const candidates = getInteractiveCandidateTexts(record?.interactive_reply, record?.message_body);
  if (candidates.length === 0) return false;
  return candidates.some((candidate) => matchesKeyword(candidate, keyword, matchType, caseSensitive));
}

/**
 * Look up the active agent (if any) for the WhatsApp account that received
 * `record`, and enqueue a run. Returns the run job's metadata or null.
 *
 * - Matches the WA account by its display_phone_number (digits-only) against
 *   the inbound record's wa_number; falls back to phone_number_id.
 * - Multiple agents may be active per WA account; see the priority order below.
 */
async function routeIfActive(record) {
  if (!record || record.direction !== 'incoming') return null;
  if (record.message_type === 'status' || record.message_type === 'reaction') return null;
  if (!record.contact_number) return null;

  if (await isContactOptedOut({ waNumber: record.wa_number, contactNumber: record.contact_number })) {
    console.log(`[agentRouter] Opted-out contact skipped messageId=${record.message_id || '-'}`);
    return null;
  }

  // A human-handover automation (or the agent's own trigger_handoff tool) may
  // have paused the AI on this contact — respect it until a human/automation
  // clears the flag (see contactMutations.triggerHandoff).
  if (record.wa_number) {
    const { rows: pausedRows } = await pool.query(
      `SELECT ai_paused FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
      [record.wa_number, record.contact_number],
    );
    if (pausedRows[0]?.ai_paused) return null;
  }

  const isAudio = (record.message_type === 'audio' || record.message_type === 'voice') && !!record.media_url;
  // Audio/voice inbounds carry a placeholder body ("Audio message" / "Voice
  // message") set by the webhook — never a real caption (WhatsApp audio has no
  // caption field). Treat them as text-less so the transcribe_audio gate below
  // is actually honoured and the worker transcribes the audio instead of
  // running the agent on the literal placeholder string.
  const hasText = !isAudio && !!(record.message_body && record.message_body.trim());
  if (!hasText && !isAudio) return null; // only text or voice notes are actionable

  // Multiple agents can be active per WA account. Keyword agents are evaluated
  // before the catch-all 'any' agent (ORDER BY puts keyword first).
  const { rows: agents } = await pool.query(
    `SELECT a.id, a.trigger_mode, a.trigger_keyword,
            a.trigger_match_type, a.trigger_case_sensitive, a.trigger_session_minutes,
            a.transcribe_audio
       FROM coexistence.agents a
       JOIN coexistence.whatsapp_accounts w ON w.id = a.wa_account_id
      WHERE a.is_active = TRUE
        AND (regexp_replace(w.display_phone_number, '\\D', '', 'g') = $1
             OR w.phone_number_id = $2)
      ORDER BY (a.trigger_mode = 'keyword') DESC, a.id ASC`,
    [record.wa_number || '', record.phone_number_id || ''],
  );
  if (agents.length === 0) return null;

  // Pick the agent by priority:
  //   1) a keyword agent whose keyword matches this message,
  //   2) a keyword agent with a live session for this contact (so a started
  //      conversation stays with it without re-typing the keyword),
  //   3) the catch-all 'any' agent.
  let chosen = null;
  if (hasText) {
    chosen = agents.find(a => a.trigger_mode === 'keyword' && matchesIncomingRecord(
      record, a.trigger_keyword, a.trigger_match_type, a.trigger_case_sensitive,
    )) || null;
  }
  if (!chosen) {
    for (const a of agents) {
      if (a.trigger_mode !== 'keyword') continue;
      const windowMin = a.trigger_session_minutes || 30;
      const { rows: recent } = await pool.query(
        `SELECT 1 FROM coexistence.agent_runs
          WHERE agent_id = $1 AND contact_number = $2
            AND started_at > NOW() - make_interval(mins => $3)
          LIMIT 1`,
        [a.id, record.contact_number, windowMin],
      );
      if (recent.length) { chosen = a; break; }
    }
  }
  if (!chosen) chosen = agents.find(a => (a.trigger_mode || 'any') !== 'keyword') || null;
  if (!chosen) return null;

  // A voice note only runs when the chosen agent has transcription enabled.
  if (isAudio && !hasText && !chosen.transcribe_audio) return null;

  await enqueueAgentRun({
    agentId: chosen.id,
    contactNumber: record.contact_number,
    inboundMessageId: record.message_id || null,
    inboundText: hasText
      ? formatInteractiveInboundText(record.interactive_reply, record.message_body)
      : null,
    inboundClassification: record.message_classification || null,
  });
  return { agentId: chosen.id };
}

module.exports = { routeIfActive, matchesIncomingRecord };
