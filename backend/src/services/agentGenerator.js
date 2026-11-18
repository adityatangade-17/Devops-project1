// AI onboarding — generate business-specific agent drafts from the venture
// profile. Reads the company profile + products/services collected by the setup
// wizard, asks the connected LLM to design a small set of practical inbound
// WhatsApp agents tailored to THIS business, and returns them for the admin to
// review and install (as paused drafts) — nothing goes live automatically.

const pool = require('../db');
const { decrypt } = require('../util/crypto');
const { getProvider } = require('../llm');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

// Resolve a usable model id from the ai_models row (or the requested one).
function pickModel(row, requested) {
  const avail = Array.isArray(row.available_models) ? row.available_models : [];
  if (requested && avail.includes(requested)) return requested;
  const prefer = row.provider === 'anthropic'
    ? avail.find(m => /sonnet/i.test(m))
    : avail.find(m => /(gpt-4o-mini|gpt-4o|gpt-4\.1)/i.test(m));
  return prefer || avail[0] || (row.provider === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini');
}

// Pull the JSON array out of the model's reply, tolerating code fences / prose.
function parseAgents(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('['); const end = t.lastIndexOf(']');
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  let arr;
  try { arr = JSON.parse(t); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(a => a && a.name && (a.system_prompt || a.systemPrompt))
    .slice(0, 6)
    .map(a => ({
      name: String(a.name).trim().slice(0, 120),
      description: String(a.description || '').trim().slice(0, 300),
      systemPrompt: String(a.system_prompt || a.systemPrompt).trim().slice(0, 8000),
      triggerMode: (a.trigger_mode || a.triggerMode) === 'keyword' ? 'keyword' : 'any',
      handoverMessage: String(a.handover_message || a.handoverMessage || 'Thank you. I am connecting you with our team. You can call {{consultant_phone}} for immediate assistance.').slice(0, 1000),
    }));
}

async function generateAgentsForBusiness({ aiModelId = null, llmModel = null } = {}) {
  // 1. Business context.
  const { rows: pRows } = await pool.query('SELECT * FROM coexistence.venture_profile WHERE id = 1');
  const profile = pRows[0] || {};
  if (!profile.company_name || !String(profile.description || '').trim()) {
    throw httpError('Add your company name and a short description in Venture Setup first, so the AI knows your business.', 400);
  }
  const { rows: products } = await pool.query('SELECT name, kind, description, price_text FROM coexistence.venture_products ORDER BY id LIMIT 50');

  // 2. Connected AI model + key.
  const { rows: models } = await pool.query(
    `SELECT * FROM coexistence.ai_models ${aiModelId ? 'WHERE id = $1' : ''} ORDER BY id LIMIT 1`,
    aiModelId ? [aiModelId] : [],
  );
  const model = models[0];
  if (!model) throw httpError('Connect an AI model first (Settings → Integrations → AI Models).', 400);
  let apiKey;
  try { apiKey = decrypt(model.api_key_encrypted); } catch { apiKey = null; }
  if (!apiKey) throw httpError('The connected AI model has no usable API key.', 400);
  const provider = getProvider(model.provider);
  const modelId = pickModel(model, llmModel);

  // 3. Prompt.
  const productLines = products.length
    ? products.map(p => `- ${p.name}${p.price_text ? ` (${p.price_text})` : ''}${p.description ? `: ${p.description}` : ''} [${p.kind}]`).join('\n')
    : '(none listed)';
  const context = [
    `Company: ${profile.company_name}`,
    profile.legal_name ? `Legal name: ${profile.legal_name}` : '',
    profile.business_type ? `Business type: ${profile.business_type}` : '',
    profile.sector ? `Sector: ${profile.sector}` : '',
    profile.website ? `Website: ${profile.website}` : '',
    `What they do: ${profile.description}`,
    `Products / services:\n${productLines}`,
  ].filter(Boolean).join('\n');

  const systemPrompt = 'You are an expert at configuring WhatsApp Business AI agents for companies. You design practical, production-ready inbound conversational agents that represent a specific business accurately and safely. You always reply with ONLY valid JSON — no prose, no markdown.';
  const userMsg = `Here is a business:\n\n${context}\n\nDesign 3–4 inbound WhatsApp AI agents this business should use (for example: a lead-qualification agent, a product/service enquiry agent, an appointment/booking agent, and a support agent — choose what fits THIS business).\n\nFor EACH agent return an object with:\n- "name": short agent name\n- "description": one sentence on what it does\n- "system_prompt": a complete, production-ready instruction set. It MUST name and represent ${profile.company_name}, reference their actual offerings, keep WhatsApp replies short and professional, reply in the customer's language, never invent prices or make promises, and hand off to a human for anything sensitive (pricing negotiation, complaints, explicit requests for a person).\n- "trigger_mode": "any" or "keyword"\n- "handover_message": the message shown when transferring to a human (use {{consultant_phone}} where the phone number should appear).\n\nReturn ONLY a JSON array of these objects.`;

  const result = await provider.runWithTools({
    systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
    tools: [],
    onToolCall: async () => ({}),
    onStep: async () => {},
    model: modelId,
    apiKey,
    maxIterations: 1,
  });

  const agents = parseAgents(result?.finalText);
  if (agents.length === 0) throw httpError('The AI did not return any usable agents. Please try again.', 502);
  return { agents, modelUsed: `${model.provider} · ${modelId}`, company: profile.company_name };
}

module.exports = { generateAgentsForBusiness, parseAgents, pickModel };
