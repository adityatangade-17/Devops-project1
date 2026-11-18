// FEATURE (c): AI SMART-REPLY SUGGESTIONS
// Place at: backend/src/routes/suggestReply.js
// Mount in app.js (see instructions):
//   const { router: suggestReplyRouter } = require('./routes/suggestReply');
//   app.use('/api', authMiddleware, suggestReplyRouter);
//
// GET /api/messages/suggest-reply?waNumber=<biz>&contactNumber=<lead>
//   -> { drafts: ["...","...","..."] }
// Reuses the same LLM provider/model/key your AI agents use (via ai_models).
const express = require('express');
const pool = require('../db');
const { decrypt } = require('../util/crypto');
const { getProvider } = require('../llm');

const router = express.Router();

// Same resolution the agent engine uses: registry key (decrypted) → env fallback.
function pickApiKey(agent) {
  const fromRegistry = decrypt(agent.ai_api_key_encrypted);
  if (fromRegistry) return fromRegistry;
  if (agent.ai_provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  if (agent.ai_provider === 'openai') return process.env.OPENAI_API_KEY || '';
  return '';
}

// Pick a working LLM config: the most recently updated active agent that has an
// AI model connected. (Single-account product → any active agent's model is fine.)
async function getUsableAgent() {
  const { rows } = await pool.query(`
    SELECT a.llm_model, am.provider AS ai_provider, am.api_key_encrypted AS ai_api_key_encrypted
    FROM coexistence.agents a
    JOIN coexistence.ai_models am ON am.id = a.ai_model_id
    WHERE a.status = 'active' AND a.ai_model_id IS NOT NULL
    ORDER BY a.updated_at DESC
    LIMIT 1
  `);
  return rows[0] || null;
}

async function buildDrafts(waNumber, contactNumber) {
  const { rows: chat } = await pool.query(`
    SELECT direction, message_body
    FROM coexistence.chat_history
    WHERE wa_number = $1 AND contact_number = $2
    ORDER BY timestamp DESC LIMIT 20
  `, [waNumber, contactNumber]);
  if (!chat.length) return { error: 'no_conversation' };

  const transcript = chat.reverse()
    .map((m) => `${m.direction === 'incoming' ? 'Customer' : 'Us'}: ${m.message_body || '(media)'}`)
    .join('\n').slice(0, 6000);

  const agent = await getUsableAgent();
  if (!agent) return { error: 'no_active_ai_model' };
  const apiKey = pickApiKey(agent);
  if (!apiKey) return { error: 'no_api_key' };

  const systemPrompt =
    'You help a human support agent at EPR Seva (EPR consulting / CEPC certification) ' +
    'reply on WhatsApp. Draft SHORT, warm, professional replies in the language the customer is using ' +
    '(English/Hindi/Hinglish). Never invent prices, dates, or guarantees. ' +
    'Output exactly 3 alternative replies, each on its own line, prefixed "1. ", "2. ", "3. " and nothing else.';
  const userMsg = `Conversation so far (oldest first):\n${transcript}\n\nDraft the next reply the agent should send. Give 3 options.`;

  const provider = getProvider(agent.ai_provider);
  const result = await provider.runWithTools({
    systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
    tools: [],
    onToolCall: async () => { throw new Error('tools not used here'); },
    onStep: async () => {},
    model: agent.llm_model,
    apiKey,
    maxIterations: 1,
  });

  const text = (result.finalText || '').trim();
  const drafts = text.split(/\n+/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean).slice(0, 3);
  return { drafts: drafts.length ? drafts : [text] };
}

router.get('/messages/suggest-reply', async (req, res) => {
  try {
    const waNumber = String(req.query.waNumber || '').replace(/\D/g, '');
    const contactNumber = String(req.query.contactNumber || '').replace(/\D/g, '');
    if (!waNumber || !contactNumber) {
      return res.status(400).json({ error: 'waNumber and contactNumber required' });
    }
    const out = await buildDrafts(waNumber, contactNumber);
    if (out.error) {
      const code = out.error === 'no_conversation' ? 404 : 400;
      return res.status(code).json(out);
    }
    res.json(out);
  } catch (e) {
    console.error('[suggest-reply] error:', e.message);
    res.status(500).json({ error: 'suggestion_failed', message: e.message });
  }
});

module.exports = { router, buildDrafts };
