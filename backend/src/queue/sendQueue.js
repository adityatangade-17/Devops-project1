// Outbound message queue — replaces BullMQ with direct async execution.
//
// On Vercel: waitUntil() extends the function lifetime until the send completes.
// On Docker: the Node.js event loop naturally keeps the promise alive after res
//            is sent, so no BullMQ / Redis is required there either.
//
// Trade-offs vs BullMQ:
//   - No Redis required (simpler deployment)
//   - No durable retry across restarts (lost if the process dies mid-send)
//   - Automation delays > ~55s may be cut short on Vercel Pro (60s max duration);
//     for long-delay automations use Vercel Cron or migrate this to QStash.

const pool = require('../db');
const { getAccountWithToken } = require('../routes/whatsappAccounts');
const {
  sendText, sendTemplate, sendMedia, sendInteractive,
  sendLocation, sendContacts, sendReaction,
} = require('../integrations/metaSend');
const { markSent, markFailed } = require('../services/messageSender');
const { markAccountHealth, classifyMetaError } = require('../services/accountHealth');
const { queueBroadcastRecipient } = require('../services/airtableBlastSync');

const ATTEMPTS = parseInt(process.env.SEND_QUEUE_ATTEMPTS || '4', 10);

// ─── core job logic ──────────────────────────────────────────────────────────

async function processJobData(jobData) {
  const { kind, accountId, to, localMessageId, payload, originRef } = jobData;

  const account = await getAccountWithToken(accountId);
  if (!account)             throw new Error(`Account id=${accountId} not found`);
  if (!account.accessToken) throw new Error('Access token missing');
  if (!account.isActive)    throw new Error(`Account "${account.displayName}" is inactive`);

  const args = { accessToken: account.accessToken, phoneNumberId: account.phoneNumberId, to };

  let result;
  try {
    if      (kind === 'text')        result = await sendText({ ...args, body: payload.body, previewUrl: payload.previewUrl, contextMessageId: payload.contextMessageId });
    else if (kind === 'template')    result = await sendTemplate({ ...args, templateName: payload.name, languageCode: payload.languageCode, components: payload.components });
    else if (kind === 'media')       result = await sendMedia({ ...args, type: payload.type, mediaId: payload.mediaId, link: payload.link, caption: payload.caption, filename: payload.filename, contextMessageId: payload.contextMessageId });
    else if (kind === 'interactive') result = await sendInteractive({ ...args, interactive: payload.interactive });
    else if (kind === 'location')    result = await sendLocation({ ...args, latitude: payload.latitude, longitude: payload.longitude, name: payload.name, address: payload.address });
    else if (kind === 'contacts')    result = await sendContacts({ ...args, contacts: payload.contacts });
    else if (kind === 'reaction')    result = await sendReaction({ ...args, messageId: payload.messageId, emoji: payload.emoji });
    else throw new Error(`unknown send kind: ${kind}`);

    await markAccountHealth(account.id, 'healthy');
  } catch (err) {
    const cls = classifyMetaError(err);
    await markAccountHealth(account.id, cls, err.message);
    if (cls === 'invalid_token') err.skipRetry = true;
    throw err;
  }

  const wamid = result?.messages?.[0]?.id;
  if (!wamid) throw new Error('Meta returned no message id');

  if (localMessageId) await markSent(localMessageId, wamid);

  if (originRef?.kind === 'broadcast_log' && originRef.id) {
    await pool.query(
      `UPDATE coexistence.broadcast_logs
          SET status = 'sent', wa_message_id = $1, sent_at = NOW()
        WHERE id = $2`,
      [wamid, originRef.id]
    ).catch(err => console.error('[sendQueue] broadcast_log update failed:', err.message));
    // Airtable reporting is best-effort and must never delay a WhatsApp send.
    queueBroadcastRecipient(originRef.id)
      .catch(err => console.error('[airtable-blast-sync] queue broadcast failed:', err.message));
  }
  if (originRef?.kind === 'automation_step' && originRef.id) {
    await pool.query(
      `UPDATE coexistence.automation_execution_steps
          SET wa_message_id = $1, wa_message_status = 'sent'
        WHERE id = $2`,
      [wamid, originRef.id]
    ).catch(() => {});
  }

  return { wamid };
}

async function runWithRetry(jobData) {
  let lastErr;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const result = await processJobData(jobData);
      console.log(`[sendQueue] ${jobData.kind} to ${jobData.to} → ${result.wamid}`);
      return result;
    } catch (err) {
      lastErr = err;
      console.error(`[sendQueue] ${jobData.kind} to ${jobData.to} failed attempt=${attempt + 1}/${ATTEMPTS}: ${err.message}`);
      if (err.skipRetry || attempt >= ATTEMPTS - 1) break;
      await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
    }
  }
  // All attempts exhausted — persist failure
  if (jobData.localMessageId) {
    await markFailed(jobData.localMessageId, lastErr.message).catch(() => {});
  }
  if (jobData.originRef?.kind === 'broadcast_log' && jobData.originRef.id) {
    await pool.query(
      `UPDATE coexistence.broadcast_logs SET status='failed', error_message=$1 WHERE id=$2`,
      [lastErr.message.slice(0, 500), jobData.originRef.id]
    ).catch(() => {});
  }
  throw lastErr;
}

// ─── background scheduling ───────────────────────────────────────────────────

let _waitUntil;
function getWaitUntil() {
  if (_waitUntil !== undefined) return _waitUntil;
  if (process.env.VERCEL) {
    try { _waitUntil = require('@vercel/functions').waitUntil; } catch { _waitUntil = null; }
  } else {
    _waitUntil = null;
  }
  return _waitUntil;
}

function background(promise) {
  const p = Promise.resolve(promise).catch(err =>
    console.error('[sendQueue] unhandled background error:', err.message)
  );
  const fn = getWaitUntil();
  if (fn) fn(p);
  // else: Node.js event loop keeps the promise alive after res is sent
}

// ─── public API ──────────────────────────────────────────────────────────────

async function enqueueSend(jobData, opts = {}) {
  const delay = opts.delayMs || 0;
  const work = async () => {
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    return runWithRetry(jobData);
  };

  // Test sends need Meta's acceptance result; bulk sends remain asynchronous.
  if (opts.waitForCompletion) return work();
  background(work());
}

// No-op stubs — kept for compatibility with callers that still import them
function startSendWorker() {}
async function shutdownSendQueue() {}

module.exports = { startSendWorker, enqueueSend, shutdownSendQueue };
