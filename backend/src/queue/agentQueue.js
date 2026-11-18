// Agent inference queue — replaces BullMQ with direct async execution.
//
// On Vercel: waitUntil() keeps the function alive while the LLM loop runs.
//   Vercel Pro allows up to 60s; complex agents may hit this limit.
//   If you need longer AI runs, migrate to QStash (https://upstash.com/qstash).
// On Docker: the event loop keeps the promise running after the webhook returns.
//
// Note: BullMQ's per-contact serialisation (jobId deduplication) is not
// replicated here. Rapid sequential messages from the same contact can start
// concurrent agent runs, which is unlikely in practice but worth noting.

const { runAgent } = require('../engine/agentEngine');

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
    console.error('[agentQueue] unhandled background error:', err.message)
  );
  const fn = getWaitUntil();
  if (fn) fn(p);
}

// ─── public API ──────────────────────────────────────────────────────────────

async function enqueueAgentRun({ agentId, contactNumber, inboundMessageId, inboundText, inboundClassification = null }) {
  background(
    runAgent({ agentId, contactNumber, inboundMessageId, inboundText, inboundClassification })
      .then(r => console.log(`[agentQueue] agent=${agentId} contact=${contactNumber} status=${r?.status} run=${r?.runId}`))
      .catch(err => console.error(`[agentQueue] agent=${agentId} contact=${contactNumber} failed: ${err.message}`))
  );
}

function startAgentWorker() {}
async function shutdownAgentQueue() {}

module.exports = { startAgentWorker, enqueueAgentRun, shutdownAgentQueue };
