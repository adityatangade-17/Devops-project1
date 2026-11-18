// Agent engine: end-to-end "inbound message → LLM tool-use loop → outbound reply".
//
// Called from the agentQueue worker (NOT inline from the webhook) so the
// webhook stays under Meta's 20s timeout. Logs everything to agent_runs +
// agent_run_steps so the UI can show a full trace.

const pool = require('../db');
const { decrypt } = require('../util/crypto');
const { getProvider } = require('../llm');
const googleSheets = require('../services/googleSheets');
const { enqueueSend } = require('../queue/sendQueue');
const { insertPendingRow } = require('../services/messageSender');
const { getAccountWithToken } = require('../routes/whatsappAccounts');
const contactMutations = require('./contactMutations');
const { retrieve } = require('../services/knowledgeBase');
const { createTask } = require('../routes/tasks');

/**
 * Build the JSON-schema tool definitions surfaced to the LLM for one agent.
 * Returns:
 *   - tools: array of { name, description, input_schema } (Anthropic shape)
 *   - executors: map from tool name → async (args) => result
 *
 * We name tools deterministically as `<tool_type>_<op>` (e.g. `google_sheets_append`)
 * so the LLM can pick the right one and so multiple Sheets tools per agent
 * (different spreadsheets) get unique names via the row id suffix.
 *
 * `agent` is the full agents row (so we can read media_groups). `sendCtx` carries
 * the live send target ({ live:true, waAccountId, contactNumber }); in test mode
 * it's { live:false } and the send_media tool only simulates.
 */
async function buildToolsForAgent(agent, sendCtx = null, { allowMediaGroups = true } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM coexistence.agent_tools
      WHERE agent_id = $1 AND is_enabled = TRUE
      ORDER BY id`,
    [agent.id],
  );

  const tools = [];
  const executors = {};

  for (const row of rows) {
    if (row.tool_type === 'google_sheets') {
      const cfg = row.config || {};
      const ops = Array.isArray(cfg.ops) ? cfg.ops : [];
      const baseDesc = `Google Sheet "${cfg.spreadsheet_name || cfg.spreadsheet_id}" tab "${cfg.sheet_name}"`;

      if (ops.includes('read')) {
        const name = `google_sheets_read_${row.id}`;
        tools.push({
          name,
          description: `Read rows from ${baseDesc}. Use this to look up information the user might be asking about.`,
          input_schema: {
            type: 'object',
            properties: {
              range: {
                type: 'string',
                description: "Optional A1 range to read (e.g. 'A2:E50'). Omit to read the whole sheet.",
              },
              max_rows: {
                type: 'integer',
                description: 'Cap the number of rows returned. Default 100, max 500.',
              },
            },
          },
        });
        executors[name] = (args) => googleSheets.executeOp({ op: 'read', toolConfig: cfg, args });
      }

      if (ops.includes('append')) {
        const name = `google_sheets_append_${row.id}`;
        tools.push({
          name,
          description: `Append a new row to ${baseDesc}. Use this to save information the user provided (booking, order, lead, etc.).`,
          input_schema: {
            type: 'object',
            properties: {
              values: {
                type: 'array',
                items: { type: ['string', 'number', 'boolean', 'null'] },
                description: 'Cell values in left-to-right column order.',
              },
            },
            required: ['values'],
          },
        });
        executors[name] = (args) => googleSheets.executeOp({ op: 'append', toolConfig: cfg, args });
      }

      if (ops.includes('update')) {
        const name = `google_sheets_update_${row.id}`;
        tools.push({
          name,
          description: `Update a specific range in ${baseDesc}. Use this only after you've used the read tool to identify which row/range to change.`,
          input_schema: {
            type: 'object',
            properties: {
              range: {
                type: 'string',
                description: "A1 range to overwrite (e.g. 'A5:E5' to replace row 5).",
              },
              values: {
                type: 'array',
                items: { type: ['string', 'number', 'boolean', 'null'] },
                description: 'New cell values for the range.',
              },
            },
            required: ['range', 'values'],
          },
        });
        executors[name] = (args) => googleSheets.executeOp({ op: 'update', toolConfig: cfg, args });
      }
    }
    // Future: gmail_send, calendar_create_event, etc. — same pattern.
  }

  // Built-in lead-capture tools — always available (not gated by an agent_tools
  // row) whenever we know who the contact is, so the agent can write qualification
  // data, tag, and escalate a conversation live rather than only via a separate
  // keyword automation. In test mode (sendCtx.live=false) these simulate instead
  // of touching real data, mirroring the send_media test path below.
  if (sendCtx) {
    const contactNumber = sendCtx.contactNumber || null;
    let waNumber = null;
    if (sendCtx.live && sendCtx.waAccountId) {
      const acc = await getAccountWithToken(sendCtx.waAccountId);
      waNumber = acc?.displayPhoneNumber ? contactMutations.normalizePhone(acc.displayPhoneNumber) : null;
    }
    const canWrite = !!(sendCtx.live && waNumber && contactNumber);

    tools.push({
      name: 'set_custom_field',
      description: 'Save a piece of information you have learned about this contact into a CRM custom field (e.g. Business Type, Product Category, Requirement). The field must already exist as a custom field in the CRM — use the exact field name.',
      input_schema: {
        type: 'object',
        properties: {
          field_name: { type: 'string', description: 'Exact name of the existing custom field, e.g. "Business Type".' },
          value: { type: 'string', description: 'Value to store.' },
        },
        required: ['field_name', 'value'],
      },
    });
    executors['set_custom_field'] = async (args) => {
      if (!canWrite) return { simulated: true, field: args?.field_name, value: args?.value };
      return contactMutations.setCustomField({ waNumber, contactNumber, fieldName: args?.field_name, value: args?.value });
    };

    tools.push({
      name: 'add_tag',
      description: 'Apply an existing CRM tag to this contact (e.g. to mark lead source, journey stage, or qualification level). The tag must already exist — use the exact tag name.',
      input_schema: {
        type: 'object',
        properties: { tag_name: { type: 'string', description: 'Exact name of the existing tag.' } },
        required: ['tag_name'],
      },
    });
    executors['add_tag'] = async (args) => {
      if (!canWrite) return { simulated: true, tag: args?.tag_name };
      return contactMutations.addTag({ waNumber, contactNumber, tagName: args?.tag_name });
    };

    tools.push({
      name: 'update_lead_score',
      description: 'Adjust the numeric "Lead Score" custom field by a point delta (positive to increase, negative to decrease). Use this as you learn qualifying details, per your scoring instructions.',
      input_schema: {
        type: 'object',
        properties: { delta: { type: 'integer', description: 'Signed point change, e.g. 15 or -10.' } },
        required: ['delta'],
      },
    });
    executors['update_lead_score'] = async (args) => {
      const delta = parseInt(args?.delta, 10);
      if (!Number.isFinite(delta)) return { ok: false, error: 'delta must be an integer' };
      if (!canWrite) return { simulated: true, delta };
      return contactMutations.updateLeadScore({ waNumber, contactNumber, delta });
    };

    // Human handover is opt-out-able per agent. When disabled, we don't surface
    // the tool at all so the agent handles the whole conversation itself.
    if (agent.human_handover_enabled !== false) {
      tools.push({
        name: 'trigger_handoff',
        description: 'Escalate this conversation to a human consultant: pauses your own auto-replies on this contact, assigns a consultant, tags the conversation, and notifies the consultant. Call this whenever your instructions say a human must take over (pricing/legal questions, complaints, explicit requests for a human, low confidence, etc.) — after sending the customer a short message telling them you are transferring them.',
        input_schema: {
          type: 'object',
          properties: { reason: { type: 'string', description: 'Short internal note on why you are escalating.' } },
          required: ['reason'],
        },
      });
      executors['trigger_handoff'] = async (args) => {
        if (!canWrite) return { simulated: true, reason: args?.reason };
        return contactMutations.triggerHandoff({
          waNumber, waAccountId: sendCtx.waAccountId, contactNumber,
          reason: args?.reason, agentId: agent.id,
        });
      };
    }

    // Read-only lookup of live booking pages so an appointment agent can hand the
    // customer the exact public booking link. Not gated by canWrite (no writes,
    // no PII) — safe in test mode too. Links resolve against CORS_ORIGIN (the
    // app's public origin, e.g. https://chat.eprseva.com), matching the
    // /book.html?service=<slug> URL the Bookings page copies.
    tools.push({
      name: 'share_booking_link',
      description: 'Get the public self-booking link(s) for our live appointment/consultation services so you can send the customer a link to pick a time themselves. Optionally pass a service_query (e.g. "EPR consultation") to narrow to the best-matching service; omit it to list all currently bookable services. Only active services are returned — if none match, tell the customer a team member will arrange a time and hand off.',
      input_schema: {
        type: 'object',
        properties: {
          service_query: { type: 'string', description: 'Optional keywords to match a service name/description, e.g. "plastic EPR".' },
        },
      },
    });
    executors['share_booking_link'] = async (args) => {
      const base = String(process.env.CORS_ORIGIN || '').replace(/\/+$/, '');
      const { rows: svcRows } = await pool.query(
        `SELECT name, slug, description, duration_minutes
           FROM coexistence.booking_services
          WHERE active = TRUE
          ORDER BY name`,
      );
      if (svcRows.length === 0) {
        return { services: [], note: 'No booking services are live right now. Offer to have a team member arrange a time, then hand off.' };
      }
      const q = String(args?.service_query || '').trim().toLowerCase();
      let picked = svcRows;
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        const scored = svcRows
          .map(s => {
            const hay = `${s.name} ${s.description || ''}`.toLowerCase();
            const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
            return { s, score };
          })
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score);
        if (scored.length > 0) picked = scored.map(x => x.s);
      }
      return {
        services: picked.slice(0, 8).map(s => ({
          name: s.name,
          description: s.description || null,
          duration_minutes: s.duration_minutes,
          link: base ? `${base}/book.html?service=${encodeURIComponent(s.slug)}` : `/book.html?service=${encodeURIComponent(s.slug)}`,
        })),
        note: 'Send the customer the link for the service they need so they can pick a slot; the meeting link is generated automatically once they confirm.',
      };
    };

    // Automatic task creation from the conversation. When the chat implies an
    // action the team must take later (a callback, a document to send, a quote,
    // a specific time to reach out), the agent logs a task that shows up on the
    // team's Tasks list — assigned to whoever owns this contact.
    tools.push({
      name: 'create_task',
      description: 'Create an internal follow-up task for the team when the conversation implies an action someone must take later — e.g. the customer asks for a callback, a document/quote, or to be contacted at a specific time. Use a clear, action-oriented title. Do not create a task for things you have already fully handled in the chat.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short action title, e.g. "Call back Rajesh about plastic EPR pricing".' },
          note: { type: 'string', description: 'Optional extra context for whoever picks up the task.' },
          due_in_hours: { type: 'integer', description: 'Optional hours from now the task is due (e.g. 24 = tomorrow).' },
          priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Optional priority; default normal.' },
        },
        required: ['title'],
      },
    });
    executors['create_task'] = async (args) => {
      const title = String(args?.title || '').trim();
      if (!title) return { ok: false, error: 'title required' };
      if (!canWrite) return { simulated: true, title };
      let dueAt = null;
      const h = parseInt(args?.due_in_hours, 10);
      if (Number.isFinite(h) && h > 0) dueAt = new Date(Date.now() + h * 3600 * 1000).toISOString();
      // Assign to the human who owns this contact; fall back to the agent's
      // default consultant.
      let assignee = agent.default_consultant_user_id || null;
      try {
        const { rows } = await pool.query(
          `SELECT assigned_user_id FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
          [waNumber, contactNumber],
        );
        if (rows[0]?.assigned_user_id) assignee = rows[0].assigned_user_id;
      } catch { /* non-fatal */ }
      try {
        const row = await createTask({
          title, description: args?.note || null, assignedUserId: assignee,
          waNumber, contactNumber, dueAt, priority: args?.priority,
          source: 'ai', agentId: agent.id,
        });
        return { ok: true, task_id: row.id };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    };
  }

  // Media-send capability. Each configured group (description + media files
  // and/or links) is surfaced to the LLM through a single `send_media` tool; the
  // model passes the index of the group whose description matches the moment in
  // the conversation, and we deliver every file AND link in that group.
  const groupSize = (g) => (Array.isArray(g.mediaIds) ? g.mediaIds.length : 0) + (Array.isArray(g.links) ? g.links.length : 0) + (g.templateId ? 1 : 0);
  const mediaGroups = Array.isArray(agent.media_groups)
    ? agent.media_groups.filter(g => g && groupSize(g) > 0)
    : [];
  if (allowMediaGroups && mediaGroups.length > 0) {
    const list = mediaGroups
      .map((g, i) => {
        const parts = [];
        const nf = Array.isArray(g.mediaIds) ? g.mediaIds.length : 0;
        const nl = Array.isArray(g.links) ? g.links.length : 0;
        if (nf) parts.push(`${nf} file(s)`);
        if (nl) parts.push(`${nl} link(s)`);
        if (g.templateId) parts.push(`1 template${g.templateName ? ` (${g.templateName})` : ''}`);
        return `[${i}] ${g.description} — ${parts.join(', ')}`;
      })
      .join('\n');
    tools.push({
      name: 'send_media',
      description:
        'Send a pre-set group of media files (image/video/audio/document) and/or links to the user on WhatsApp. '
        + 'Call this when the conversation matches one of these groups:\n' + list
        + '\nPass the group_index of the group to send — it delivers every file and link in that group directly. '
        + 'Do not try to describe or paste the files/links in text; calling this is what sends them.',
      input_schema: {
        type: 'object',
        properties: {
          group_index: {
            type: 'integer',
            description: 'Index of the media group to send (see the numbered list above).',
          },
        },
        required: ['group_index'],
      },
    });
    executors['send_media'] = async (args) => {
      const idx = parseInt(args?.group_index, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= mediaGroups.length) {
        return { sent: false, error: `Invalid group_index ${args?.group_index}. Valid range: 0..${mediaGroups.length - 1}.` };
      }
      const group = mediaGroups[idx];
      if (!sendCtx || !sendCtx.live) {
        // Test panel: never send to a real number — record what would be sent so
        // the live-preview can render the media/links, then report to the LLM.
        if (sendCtx && Array.isArray(sendCtx.collected)) sendCtx.collected.push(group);
        return { sent: true, simulated: true, group: group.description, file_count: (group.mediaIds || []).length, link_count: (group.links || []).length, template: group.templateName || (group.templateId ? `#${group.templateId}` : null), note: 'Delivered in the test preview.' };
      }
      return await sendMediaGroup({ group, waAccountId: sendCtx.waAccountId, contactNumber: sendCtx.contactNumber });
    };
  }

  return { tools, executors };
}

/**
 * Deliver every media item in a group to the contact on WhatsApp. Mirrors the
 * automation engine's direct-media path: resolve each media_library item to a
 * per-account Meta media handle (sync if stale), drop an optimistic outbound
 * chat_history row, mirror the bytes to disk so the bubble previews, then
 * enqueue the send on the shared sendQueue.
 */
async function sendMediaGroup({ group, waAccountId, contactNumber }) {
  const { syncMediaToAccount } = require('../routes/mediaLibrary');
  const account = await getAccountWithToken(waAccountId);
  if (!account || !account.displayPhoneNumber) {
    return { sent: false, error: 'No usable WhatsApp account bound to this agent.' };
  }

  const sent = [];
  for (const rawId of group.mediaIds) {
    const mediaId = parseInt(rawId, 10);
    if (!Number.isInteger(mediaId)) continue;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM coexistence.media_library WHERE id = $1 AND deleted_at IS NULL`,
        [mediaId],
      );
      const media = rows[0];
      if (!media) continue;

      // Resolve (or refresh) the per-account Meta media handle.
      const { rows: sRows } = await pool.query(
        `SELECT * FROM coexistence.media_meta_sync WHERE media_id = $1 AND account_id = $2`,
        [media.id, waAccountId],
      );
      let metaMediaId = sRows[0]?.meta_media_id;
      const stale = !sRows[0] || sRows[0].status !== 'synced' || !metaMediaId
        || (sRows[0].expires_at && new Date(sRows[0].expires_at) <= new Date());
      if (stale) {
        const synced = await syncMediaToAccount(media.id, waAccountId);
        metaMediaId = synced.metaMediaId;
      }
      if (!metaMediaId) continue;

      const type = media.media_type; // image | video | audio | document
      const localMessageId = await insertPendingRow({
        account,
        toNumber: contactNumber,
        messageType: type,
        messageBody: null,
        mediaMime: media.mime_type,
      });

      // Mirror the library file to local disk so the outbound bubble can
      // preview it (best-effort; a failure must not block the Meta send).
      try {
        const { getObjectBuffer } = require('../util/pgStorage');
        const { persistOutboundBuffer } = require('../services/mediaDownloader');
        const buf = await getObjectBuffer(media.storage_key);
        const ext = (media.original_name || '').split('.').pop()?.toLowerCase()
          || (media.mime_type || '').split('/')[1] || 'bin';
        const acctDigits = String(account.displayPhoneNumber || '').replace(/\D/g, '');
        const { absPath, size } = persistOutboundBuffer({ accountPhoneDigits: acctDigits, messageId: localMessageId, buffer: buf, ext });
        await pool.query(
          `UPDATE coexistence.chat_history
              SET media_storage_path = $1, media_status = 'stored', media_size_bytes = $2,
                  media_mime_type = COALESCE(media_mime_type, $3), media_filename = $4, media_downloaded_at = NOW()
            WHERE message_id = $5`,
          [absPath, size, media.mime_type, media.original_name, localMessageId],
        );
      } catch (mErr) {
        console.error('[agentEngine] media mirror failed:', mErr.message);
      }

      await enqueueSend({
        kind: 'media',
        accountId: waAccountId,
        to: contactNumber,
        localMessageId,
        payload: {
          type,
          mediaId: metaMediaId,
          filename: type === 'document' ? media.original_name : undefined,
        },
      });
      sent.push(media.name || media.original_name || `media#${media.id}`);
    } catch (e) {
      console.error('[agentEngine] sendMediaGroup item failed:', e.message);
    }
  }

  // Send each link as a text message with a link preview (preview_url=true).
  const sentLinks = [];
  for (const url of (Array.isArray(group.links) ? group.links : [])) {
    try {
      const localMessageId = await insertPendingRow({
        account, toNumber: contactNumber, messageType: 'text', messageBody: url,
      });
      await enqueueSend({
        kind: 'text',
        accountId: waAccountId,
        to: contactNumber,
        localMessageId,
        payload: { body: url, previewUrl: true },
      });
      sentLinks.push(url);
    } catch (e) {
      console.error('[agentEngine] sendMediaGroup link failed:', e.message);
    }
  }

  // Finally, fire the attached approved template (if any) — e.g. a menu or
  // order-confirmation template. Mirrors the broadcast/template send path:
  // insert a pending 'template' row (with template_meta so the bubble renders),
  // then enqueue a `kind:'template'` send. Variable bindings aren't supported
  // here, so this is for static (no-{{1}}) templates; the WABA must match the
  // agent's number (guaranteed — the picker is account-scoped).
  let sentTemplate = null;
  if (group.templateId) {
    try {
      const { rows: tRows } = await pool.query(
        `SELECT id, name, language, body, header_type, header_text, footer, buttons,
                whatsapp_account_id, status
           FROM coexistence.message_templates WHERE id = $1`,
        [parseInt(group.templateId, 10)],
      );
      const tpl = tRows[0];
      if (tpl && String(tpl.whatsapp_account_id) === String(waAccountId) && tpl.status === 'APPROVED') {
        const localMessageId = await insertPendingRow({
          account, toNumber: contactNumber, messageType: 'template',
          messageBody: tpl.body || `Template: ${tpl.name}`,
          templateMeta: {
            header_type: tpl.header_type || 'NONE',
            header_text: tpl.header_text || null,
            footer: tpl.footer || null,
            buttons: Array.isArray(tpl.buttons) ? tpl.buttons : (tpl.buttons || []),
          },
        });
        await enqueueSend({
          kind: 'template',
          accountId: waAccountId,
          to: String(contactNumber).replace(/\D/g, ''),
          localMessageId,
          payload: { name: tpl.name, languageCode: tpl.language || 'en', components: [] },
        });
        sentTemplate = tpl.name;
      } else {
        console.error('[agentEngine] sendMediaGroup template skipped: not found / wrong account / not approved', group.templateId);
      }
    } catch (e) {
      console.error('[agentEngine] sendMediaGroup template failed:', e.message);
    }
  }

  return {
    sent: (sent.length + sentLinks.length + (sentTemplate ? 1 : 0)) > 0,
    file_count: sent.length, link_count: sentLinks.length,
    files: sent, links: sentLinks, template: sentTemplate, group: group.description,
  };
}

/**
 * Pull recent chat history for this contact, oldest-first, capped at the
 * agent's context window. Skips status updates and reactions.
 */
async function buildMessageHistory({ waAccountId, contactNumber, limit, currentInboundText }) {
  // Resolve the agent's wa_number from the WhatsApp account
  let waNumber = null;
  if (waAccountId) {
    const acc = await getAccountWithToken(waAccountId);
    waNumber = acc?.displayPhoneNumber || null;
  }

  const { rows } = waNumber
    ? await pool.query(
        `SELECT direction, message_body, timestamp
           FROM coexistence.chat_history
          WHERE wa_number = $1 AND contact_number = $2
            AND message_type NOT IN ('status','reaction')
            AND message_body IS NOT NULL AND message_body <> ''
          ORDER BY timestamp DESC
          LIMIT $3`,
        [waNumber, contactNumber, Math.max(1, Math.min(100, limit || 20))],
      )
    : { rows: [] };

  // DB returned newest-first for the LIMIT; reverse to chronological.
  const history = rows.reverse().map(r => ({
    role: r.direction === 'incoming' ? 'user' : 'assistant',
    content: r.message_body,
  }));

  // The current inbound message may not yet be persisted (timing race vs.
  // webhook commit). Append it as the last user message if it isn't there.
  const last = history[history.length - 1];
  if (currentInboundText && !(last && last.role === 'user' && last.content === currentInboundText)) {
    history.push({ role: 'user', content: currentInboundText });
  }
  return history;
}

// Provider + key now come from the agent's referenced ai_models registry row
// (joined as ai_provider / ai_api_key_encrypted). The registry key wins; if the
// row has none (shouldn't happen — the route requires a key) or the agent has no
// model bound, fall back to the server-wide env key for that provider.
function pickApiKey(agent) {
  const fromRegistry = decrypt(agent.ai_api_key_encrypted);
  if (fromRegistry) return fromRegistry;
  if (agent.ai_provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  if (agent.ai_provider === 'openai')    return process.env.OPENAI_API_KEY || '';
  return '';
}

// Resolve an OpenAI key for Whisper transcription: the agent's own key if it's
// an OpenAI agent, otherwise any OpenAI credential connected in the AI Models
// registry (falling back to the env key).
async function resolveOpenAiKey(agent, agentApiKey) {
  if (agent.ai_provider === 'openai' && agentApiKey) return agentApiKey;
  try {
    const { rows } = await pool.query(
      `SELECT api_key_encrypted FROM coexistence.ai_models
        WHERE provider = 'openai' AND api_key_encrypted IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
    );
    if (rows[0]) {
      const k = decrypt(rows[0].api_key_encrypted);
      if (k) return k;
    }
  } catch (e) {
    console.error('[agentEngine] resolveOpenAiKey failed:', e.message);
  }
  return process.env.OPENAI_API_KEY || '';
}

// If the inbound message is a voice note, download + transcribe it (OpenAI
// Whisper). Writes the transcript back into chat_history so it shows in the
// conversation + future context, and returns the text ('' if not audio / no
// OpenAI key / transcription failed).
async function transcribeInboundIfAudio({ agent, inboundMessageId, agentApiKey }) {
  try {
    const { rows } = await pool.query(
      `SELECT message_id, message_type, message_body
         FROM coexistence.chat_history WHERE message_id = $1`,
      [inboundMessageId],
    );
    const msg = rows[0];
    if (!msg) return '';
    const isAudio = msg.message_type === 'audio' || msg.message_type === 'voice';
    // Non-audio: any real text body IS the message; nothing to transcribe.
    if (!isAudio) {
      return (msg.message_body && msg.message_body.trim()) ? msg.message_body.trim() : '';
    }
    // Audio/voice: the stored body is only a placeholder ("Audio message" /
    // "Voice message"), so ignore it and transcribe the actual audio. (Without
    // this, the truthy placeholder short-circuited transcription entirely.)

    const openaiKey = await resolveOpenAiKey(agent, agentApiKey);
    if (!openaiKey) {
      console.warn('[agentEngine] voice note received but no OpenAI key connected for transcription.');
      return '';
    }
    const { downloadOne } = require('../services/mediaDownloader');
    const { transcribeAudioFile } = require('../services/transcription');
    const dl = await downloadOne(inboundMessageId);
    if (!dl || !dl.ok || !dl.path) {
      console.warn('[agentEngine] could not fetch audio for transcription:', dl && dl.error);
      return '';
    }
    const text = await transcribeAudioFile({ filePath: dl.path, apiKey: openaiKey });
    if (!text) return '';
    // Surface the transcript in the chat (and future agent context), replacing
    // the placeholder body the webhook stored for the voice note.
    await pool.query(
      `UPDATE coexistence.chat_history SET message_body = $1
        WHERE message_id = $2
          AND (message_body IS NULL OR message_body = ''
               OR message_body IN ('Audio message', 'Voice message'))`,
      [text, inboundMessageId],
    );
    return text;
  } catch (e) {
    console.error('[agentEngine] transcription failed:', e.message);
    return '';
  }
}

async function recordStep(runId, stepIndex, step) {
  await pool.query(
    `INSERT INTO coexistence.agent_run_steps
       (run_id, step_index, step_type, tool_type, input, output, status, latency_ms, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      runId,
      stepIndex,
      step.step_type,
      step.tool_type || null,
      step.input ? JSON.stringify(step.input) : null,
      step.output != null ? JSON.stringify(step.output) : null,
      step.status,
      step.latency_ms || null,
      step.error_message ? String(step.error_message).slice(0, 1000) : null,
    ],
  );
}

/**
 * Append a small context block so the LLM knows the customer's WhatsApp number
 * (the chat history never carries it). Without this the agent can't fill a
 * "Mobile Number" column when saving an order to a sheet.
 */
function withContactContext(systemPrompt, contactNumber) {
  const base = systemPrompt || '';
  if (!contactNumber) return base;
  return `${base}\n\n## Conversation context\n- The customer's WhatsApp number is ${contactNumber}. When you need their mobile number (e.g. saving an order to a sheet), use this exact number — never ask the customer for it.`;
}

function withMessageClassificationContext(systemPrompt, classification) {
  if (classification?.kind !== 'AUTO_RESPONSE') return systemPrompt || '';
  return `${systemPrompt || ''}\n\n## Incoming message classification\n- Classification: AUTO_RESPONSE\n- Confidence: ${Number(classification.confidence || 0).toFixed(2)}\n- This is likely an automated acknowledgement, not a personal customer reply.\n- Send at most ONE short, natural WhatsApp response. Do not send a generic thank-you or acknowledgement.\n- Prefer asking for a suitable time to call or speak; do not invent a time.\n- Do not use media, links, templates, or multiple messages for this turn.`;
}

function groundedPrompt(systemPrompt, chunks) {
  const sources = chunks.map((c, i) => `[Source ${i + 1}: ${c.title || c.original_name}]\n${c.content}`).join('\n\n');
  return `${systemPrompt}\n\n## Approved knowledge retrieved for this reply\n${sources}\n\n## Grounding rules\n1. Answer ONLY with facts supported by the approved knowledge above.\n2. Do NOT use general knowledge outside these sources, make assumptions, or add unverified details.\n3. Include source citations in your reply when referencing facts (e.g. "Based on: [Document Title]").\n4. If the material does not directly answer the customer, state you are connecting them with a specialist and call trigger_handoff.`;
}

function handoverText(agent, handoff) {
  const phone = handoff?.consultantPhone ? String(handoff.consultantPhone).trim() : '';
  const tmpl = String(agent.handover_message || 'Thank you. This needs a specialist review, so I am connecting you with our team. You can call {{consultant_phone}} for immediate assistance.');
  if (phone) {
    return tmpl.replace(/{{consultant_phone}}/g, phone);
  }
  if (tmpl.includes('{{consultant_phone}}')) {
    return 'Thank you. Your question needs a specialist review so we can give you accurate guidance. I have shared your details with our team, who will contact you shortly.';
  }
  return tmpl;
}

/**
 * Main entry. Loads the agent, builds tools + context, runs the LLM loop,
 * persists everything, and enqueues the final reply on the existing sendQueue.
 */
async function runAgent({ agentId, contactNumber, inboundMessageId, inboundText, inboundClassification = null }) {
  const { rows: agentRows } = await pool.query(
    `SELECT a.*, am.provider AS ai_provider, am.api_key_encrypted AS ai_api_key_encrypted
       FROM coexistence.agents a
       LEFT JOIN coexistence.ai_models am ON am.id = a.ai_model_id
      WHERE a.id = $1`,
    [agentId],
  );
  const agent = agentRows[0];
  if (!agent) throw new Error(`Agent id=${agentId} not found`);
  if (!agent.is_active) throw new Error(`Agent id=${agentId} is inactive`);
  if (!agent.wa_account_id) throw new Error(`Agent id=${agentId} has no WhatsApp account bound`);
  if (!agent.ai_provider) throw new Error(`Agent id=${agentId} has no AI model connected. Connect one under Admin Settings → Integrations → AI Models.`);

  const apiKey = pickApiKey(agent);
  if (!apiKey) {
    throw new Error(`No API key for provider '${agent.ai_provider}'. Add it under Integrations → AI Models, or set ${agent.ai_provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in backend/.env.`);
  }

  // Voice notes: when the agent has transcription on and the inbound is audio
  // (no text body), turn it into text via Whisper before running the LLM loop.
  let messageText = inboundText;
  if (!messageText && inboundMessageId && agent.transcribe_audio) {
    messageText = await transcribeInboundIfAudio({ agent, inboundMessageId, agentApiKey: apiKey });
    if (!messageText) {
      console.warn(`[agentEngine] agent ${agent.id}: inbound ${inboundMessageId} had no usable transcript; skipping run.`);
      return { skipped: true, reason: 'no_transcript' };
    }
  }

  // Open the run row immediately so a crash mid-loop is still visible in the UI.
  const { rows: runRows } = await pool.query(
    `INSERT INTO coexistence.agent_runs
       (agent_id, wa_account_id, contact_number, inbound_message_id, status)
     VALUES ($1,$2,$3,$4,'running')
     RETURNING id`,
    [agent.id, agent.wa_account_id, contactNumber, inboundMessageId || null],
  );
  const runId = runRows[0].id;

  let stepCounter = 0;
  const onStep = async (step) => {
    stepCounter += 1;
    try {
      await recordStep(runId, stepCounter, step);
    } catch (e) {
      console.error('[agentEngine] step persist failed:', e.message);
    }
  };

  try {
    const { tools, executors } = await buildToolsForAgent(agent, {
      live: true,
      waAccountId: agent.wa_account_id,
      contactNumber,
    }, { allowMediaGroups: inboundClassification?.kind !== 'AUTO_RESPONSE' });
    const history = await buildMessageHistory({
      waAccountId: agent.wa_account_id,
      contactNumber,
      limit: agent.context_window_messages,
      currentInboundText: messageText,
    });

    const handoffEnabled = agent.human_handover_enabled !== false;
    let result;
    let effectivePrompt = withContactContext(agent.system_prompt, contactNumber);
    effectivePrompt = withMessageClassificationContext(effectivePrompt, inboundClassification);
    if (!handoffEnabled) {
      // Make the disabled state explicit so the model doesn't keep trying to
      // transfer (the tool isn't registered, so any attempt would just fail).
      effectivePrompt += '\n\n## Human handover is turned OFF for you\nThere is no way to transfer this chat to a person. Do not tell the customer you are connecting them to someone or that a specialist will take over. Handle the whole conversation yourself. If something is genuinely outside what you can answer, invite the customer to call or email the office rather than promising a callback.';
    }
    // Strict RAG grounding only applies when a knowledge base is actually
    // attached. Without one, strict mode used to force a handoff on EVERY message
    // (nothing could ever "match"), which turned every chat over to a human —
    // so treat KB-less strict agents as normal assistants.
    if (agent.grounding_mode === 'strict' && agent.knowledge_base_id) {
      let retrieval;
      const t0 = Date.now();
      try {
        retrieval = await retrieve({
          knowledgeBaseId: agent.knowledge_base_id,
          query: messageText,
          minScore: agent.retrieval_min_score,
          maxChunks: agent.retrieval_max_chunks,
        });
      } catch (e) {
        retrieval = { matched: false, error: e.message, chunks: [] };
      }
      const latencyMs = Date.now() - t0;

      await onStep({
        step_type: 'rag_retrieval',
        tool_type: 'knowledge_base',
        input: { knowledgeBaseId: agent.knowledge_base_id, query: messageText, minScore: agent.retrieval_min_score },
        output: { matched: retrieval.matched, chunkCount: (retrieval.chunks || []).length, topScore: retrieval.chunks?.[0]?.score || 0 },
        status: retrieval.matched ? 'completed' : 'no_match',
        latency_ms: latencyMs,
        error_message: retrieval.error || (retrieval.matched ? null : 'No approved knowledge cleared match threshold'),
      });

      if (!retrieval.matched && handoffEnabled) {
        const waAccount = await getAccountWithToken(agent.wa_account_id);
        const handoff = await contactMutations.triggerHandoff({
          waNumber: waAccount?.displayPhoneNumber ? contactMutations.normalizePhone(waAccount.displayPhoneNumber) : null,
          waAccountId: agent.wa_account_id,
          contactNumber,
          reason: retrieval?.error || 'No approved knowledge matched the enquiry',
          agentId: agent.id,
        });
        result = { finalText: handoverText(agent, handoff), totalInputTokens: 0, totalOutputTokens: 0 };
      } else if (retrieval.matched) {
        effectivePrompt = groundedPrompt(effectivePrompt, retrieval.chunks);
      } else {
        // Strict + KB but nothing matched AND handover is off: don't transfer —
        // let the model reply within its limits without inventing facts.
        effectivePrompt += '\n\n## No approved knowledge matched this question\nAnswer only what you can support generally and safely; do not make up specifics. If you cannot help, invite the customer to call or email the office.';
      }
    }
    if (!result) {
      const provider = getProvider(agent.ai_provider);
      result = await provider.runWithTools({
      systemPrompt: effectivePrompt,
      messages: history,
      tools,
      onToolCall: async ({ name, args }) => {
        const exec = executors[name];
        if (!exec) throw new Error(`Unknown tool '${name}'`);
        return await exec(args);
      },
      onStep,
      model: agent.llm_model,
      apiKey,
      maxIterations: Math.max(1, Math.min(20, agent.max_tool_iterations || 6)),
      });
    }

    const finalStatus = result.capped ? 'capped' : 'completed';
    await pool.query(
      `UPDATE coexistence.agent_runs
          SET status=$1, total_input_tokens=$2, total_output_tokens=$3,
              final_reply=$4, ended_at=NOW()
        WHERE id=$5`,
      [finalStatus, result.totalInputTokens, result.totalOutputTokens,
       result.finalText || null, runId],
    );

    if (result.finalText) {
      // Insert an optimistic chat_history row FIRST so the agent's reply shows
      // up in the Chats UI immediately (status='sending'), then the existing
      // sendQueue worker swaps the local id for Meta's wamid on success
      // (markSent) or marks it failed (markFailed). Without this row, the
      // message is delivered to WhatsApp but never appears in our own UI.
      const account = await getAccountWithToken(agent.wa_account_id);
      let localMessageId = null;
      if (account && account.displayPhoneNumber) {
        try {
          localMessageId = await insertPendingRow({
            account,
            toNumber: contactNumber,
            messageType: 'text',
            messageBody: result.finalText,
          });
        } catch (e) {
          console.error('[agentEngine] optimistic row insert failed:', e.message);
        }
      }
      await enqueueSend({
        kind: 'text',
        accountId: agent.wa_account_id,
        to: contactNumber,
        localMessageId,
        payload: { body: result.finalText },
      });
    }
    return { runId, status: finalStatus, finalText: result.finalText };
  } catch (err) {
    await pool.query(
      `UPDATE coexistence.agent_runs
          SET status='failed', error_message=$1, ended_at=NOW()
        WHERE id=$2`,
      [String(err.message || err).slice(0, 1000), runId],
    );
    throw err;
  }
}

/**
 * Dry-run an agent for the in-app test chat panel. Same loading + tool
 * execution as runAgent, but:
 *   - Does NOT enqueue a real WhatsApp send (no chat_history write).
 *   - Does NOT persist to agent_runs / agent_run_steps (test interactions
 *     would otherwise pollute the run history).
 *   - Accepts an explicit messages[] array so the operator can simulate a
 *     multi-turn conversation without writing to chat_history.
 *   - Returns the full step trace inline so the UI can show what the LLM
 *     called and what tools fired.
 *
 * `messages` shape: [{ role: 'user'|'assistant', content: string }] — same as
 * the runtime hydrates from chat_history in runAgent.
 */
async function runAgentTest({ agentId, messages }) {
  const { rows: agentRows } = await pool.query(
    `SELECT a.*, am.provider AS ai_provider, am.api_key_encrypted AS ai_api_key_encrypted
       FROM coexistence.agents a
       LEFT JOIN coexistence.ai_models am ON am.id = a.ai_model_id
      WHERE a.id = $1`,
    [agentId],
  );
  const agent = agentRows[0];
  if (!agent) throw new Error(`Agent id=${agentId} not found`);
  if (!agent.ai_provider) throw new Error('This agent has no AI model connected yet. Connect one under Integrations → AI Models, then pick it in the Model section.');
  if (!agent.llm_model) throw new Error('Pick a model in the Model section before testing.');

  const apiKey = pickApiKey(agent);
  if (!apiKey) {
    throw new Error(`No API key for provider '${agent.ai_provider}'. Add it under Integrations → AI Models, or set ${agent.ai_provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in backend/.env.`);
  }

  // `collected` gathers the media groups the agent "sends" so the live preview
  // can render the actual images/audio/links (test mode doesn't hit WhatsApp).
  const sendCtx = { live: false, collected: [] };
  const { tools, executors } = await buildToolsForAgent(agent, sendCtx);

  const steps = [];
  const onStep = async (step) => {
    steps.push({
      stepIndex: steps.length + 1,
      stepType: step.step_type,
      toolType: step.tool_type || null,
      input: step.input,
      output: step.output,
      status: step.status,
      latencyMs: step.latency_ms || null,
      errorMessage: step.error_message || null,
    });
  };

  const cleaned = Array.isArray(messages)
    ? messages.filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'))
    : [];
  if (cleaned.length === 0) {
    throw new Error('At least one message is required (role=user|assistant, non-empty content).');
  }

  const provider = getProvider(agent.ai_provider);
  const result = await provider.runWithTools({
    systemPrompt: withContactContext(agent.system_prompt, 'test'),
    messages: cleaned,
    tools,
    onToolCall: async ({ name, args }) => {
      const exec = executors[name];
      if (!exec) throw new Error(`Unknown tool '${name}'`);
      return await exec(args);
    },
    onStep,
    model: agent.llm_model,
    apiKey,
    maxIterations: Math.max(1, Math.min(20, agent.max_tool_iterations || 6)),
  });

  // Resolve the media the agent chose to send (dedup by id) so the preview can
  // render real thumbnails/players, plus any links.
  const mediaIds = [...new Set(sendCtx.collected.flatMap(g => (g.mediaIds || []).map(n => parseInt(n, 10)).filter(Number.isInteger)))];
  const links = [...new Set(sendCtx.collected.flatMap(g => g.links || []))];
  let media = [];
  if (mediaIds.length) {
    const { rows: mrows } = await pool.query(
      `SELECT id, media_type, name, original_name, mime_type
         FROM coexistence.media_library WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [mediaIds],
    );
    // Preserve the order the agent sent them in.
    const byId = new Map(mrows.map(r => [Number(r.id), r]));
    media = mediaIds.map(id => byId.get(id)).filter(Boolean).map(r => ({
      id: Number(r.id),
      type: r.media_type,
      name: r.name || r.original_name || `media #${r.id}`,
      mimeType: r.mime_type,
    }));
  }

  return {
    reply: result.finalText || '',
    status: result.capped ? 'capped' : 'completed',
    totalInputTokens: result.totalInputTokens,
    totalOutputTokens: result.totalOutputTokens,
    iterations: result.iterations,
    steps,
    media,
    links,
  };
}

// Resolve an OpenAI key for the agent and transcribe an uploaded audio file —
// used by the in-app test chat's mic button.
async function transcribeForAgent({ agentId, filePath }) {
  const { rows } = await pool.query(
    `SELECT a.*, am.provider AS ai_provider, am.api_key_encrypted AS ai_api_key_encrypted
       FROM coexistence.agents a
       LEFT JOIN coexistence.ai_models am ON am.id = a.ai_model_id
      WHERE a.id = $1`,
    [agentId],
  );
  const agent = rows[0];
  if (!agent) throw new Error('Agent not found');
  const openaiKey = await resolveOpenAiKey(agent, pickApiKey(agent));
  if (!openaiKey) throw new Error('No OpenAI key connected. Add one under Integrations → AI Models to transcribe voice notes.');
  const { transcribeAudioFile } = require('../services/transcription');
  return await transcribeAudioFile({ filePath, apiKey: openaiKey });
}

module.exports = { runAgent, runAgentTest, buildToolsForAgent, buildMessageHistory, transcribeForAgent, withMessageClassificationContext };
