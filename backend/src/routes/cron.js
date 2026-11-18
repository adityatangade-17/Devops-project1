// Cron job endpoints — called by Vercel Cron on a schedule.
// On Docker these intervals are handled by setInterval in index.js instead.
//
// Vercel always calls cron paths as GET requests and injects:
//   Authorization: Bearer <CRON_SECRET>
// where CRON_SECRET is auto-set by Vercel. If the env var is absent (local dev /
// Docker) the check is skipped so the routes remain manually testable.

const { Router } = require('express');
const pool = require('../db');
const { syncAllAccountTemplates } = require('./templates');
const { reconcileMessageStatuses } = require('../services/statusReconciler');
const { runBookingSweeps } = require('../services/bookingReminders');
const { runOutboundCampaigns } = require('../services/outboundCampaigns');
const { deliverWeeklyIfDue } = require('../services/managerReport');

const router = Router();

function verifyCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// GET /api/cron/reconcile
// Fixes any outbound message status ticks that fell out of sync with webhook
// receipts (runs every minute on Vercel; boot + every-60s interval on Docker).
router.get('/cron/reconcile', verifyCron, async (req, res) => {
  try {
    const n = await reconcileMessageStatuses({ windowDays: 2 });
    res.json({ fixed: n });
  } catch (err) {
    console.error('[cron/reconcile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/sweep
// Expires paused automations past their timeout and reaps orphaned running
// executions (every 30 min on Vercel; every-30-min interval on Docker).
router.get('/cron/sweep', verifyCron, async (req, res) => {
  try {
    const { rowCount: paused } = await pool.query(
      `UPDATE coexistence.automation_executions
          SET status='error',
              error_message='Paused execution expired (no reply within timeout)',
              completed_at=NOW()
        WHERE status='paused' AND expires_at < NOW()`
    );
    if (paused > 0) console.log(`[cron/sweep] expired ${paused} paused execution(s)`);

    const { rowCount: orphans } = await pool.query(
      `UPDATE coexistence.automation_executions
          SET status='error',
              error_message='Execution interrupted (no completion within 15 minutes)',
              completed_at=NOW()
        WHERE status='running' AND started_at < NOW() - INTERVAL '15 minutes'`
    );
    if (orphans > 0) console.log(`[cron/sweep] reaped ${orphans} orphaned execution(s)`);

    res.json({ paused, orphans });
  } catch (err) {
    console.error('[cron/sweep]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/sync-templates
// Polls Meta for template status updates (only fires if there are pending
// submissions; every 10 min on Vercel; every-10-min interval on Docker).
router.get('/cron/sync-templates', verifyCron, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS pending
         FROM coexistence.message_templates
        WHERE status = 'SUBMITTED'`
    );
    const pending = rows[0]?.pending || 0;
    if (pending === 0) return res.json({ skipped: true, reason: 'no pending templates' });

    const r = await syncAllAccountTemplates();
    if (r.totalUpdated > 0) {
      console.log(`[cron/sync-templates] ${pending} pending → updated ${r.totalUpdated}`);
    }
    res.json({ updated: r.totalUpdated, pending });
  } catch (err) {
    console.error('[cron/sync-templates]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/booking-reminders
// Sends the 24h-before and 1h-before booking reminders plus post-appointment
// no-show recovery (every ~5 min on Docker via index.js; Vercel cron on Vercel).
// Idempotent.
router.get('/cron/booking-reminders', verifyCron, async (req, res) => {
  try {
    const result = await runBookingSweeps();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/booking-reminders]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/outbound-campaigns
// Runs the enabled Recovery / Reactivation / Collection agents (every ~15 min on
// Docker via index.js). No-op unless a campaign is enabled + template-configured.
router.get('/cron/outbound-campaigns', verifyCron, async (req, res) => {
  try {
    const result = await runOutboundCampaigns();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/outbound-campaigns]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/manager-report — generate + deliver the weekly Manager report if
// the configured IST day/hour has arrived (no-op otherwise; dedup per day).
router.get('/cron/manager-report', verifyCron, async (req, res) => {
  try {
    const result = await deliverWeeklyIfDue();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/manager-report]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router };
