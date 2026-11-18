// Media download queue — replaces BullMQ with direct async execution.
//
// Inbound media (photos, audio, video, documents) is downloaded from Meta's
// CDN and stored in PostgreSQL via pgStorage. The download is fast enough
// that waitUntil() keeps the Vercel function alive comfortably within limits.
//
// Retries with exponential backoff are preserved. Media is stored in PostgreSQL
// as bytea (pgStorage), so no external object store is needed.

const { downloadOne } = require('../services/mediaDownloader');

const ATTEMPTS  = parseInt(process.env.MEDIA_QUEUE_ATTEMPTS  || '5',    10);
const BACKOFF_MS = parseInt(process.env.MEDIA_QUEUE_BACKOFF_MS || '2000', 10);

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
    console.error('[mediaQueue] unhandled background error:', err.message)
  );
  const fn = getWaitUntil();
  if (fn) fn(p);
}

// ─── core logic ──────────────────────────────────────────────────────────────

async function downloadWithRetry(messageId) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const result = await downloadOne(messageId);
    if (result.ok) {
      console.log(`[mediaQueue] ${messageId} stored`);
      return result;
    }
    console.error(`[mediaQueue] ${messageId} failed attempt=${attempt + 1}/${ATTEMPTS}: ${result.error}`);
    if (attempt < ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, BACKOFF_MS * Math.pow(2, attempt)));
    }
  }
}

// ─── public API ──────────────────────────────────────────────────────────────

async function enqueueMediaDownload(messageId) {
  if (!messageId) return;
  background(downloadWithRetry(messageId));
}

function startWorker() {}
async function shutdown() {}

module.exports = { startWorker, enqueueMediaDownload, shutdown };
