// Docker server entry — NOT used on Vercel (see api/index.js).
// Boots the Express app, runs migrations, and starts periodic maintenance jobs.

require('dotenv').config();
require('./util/instanceSecrets').bootstrapSecrets();

const pool = require('./db');
const { ensureTables } = require('./auth');
const { runMigrations } = require('./db/migrate');
const { router: templatesRouter, syncAllAccountTemplates } = require('./routes/templates');
const { reconcileMessageStatuses } = require('./services/statusReconciler');
const { runBookingSweeps } = require('./services/bookingReminders');
const { runOutboundCampaigns } = require('./services/outboundCampaigns');
const { deliverWeeklyIfDue } = require('./services/managerReport');
const { backfillAirtableBlastData, runAirtableBlastSync, isEnabled: isAirtableBlastSyncEnabled } = require('./services/airtableBlastSync');
const mediaStorage = require('./util/pgStorage');
const app = require('./app');

const PORT = parseInt(process.env.PORT || '3001', 10);

async function start() {
  await runMigrations(pool);
  await ensureTables();
  mediaStorage.ensureBucket().catch(err =>
    console.error('[media-storage] table ensure failed (will retry on first upload):', err.message)
  );

  // Airtable uses a durable local queue, so startup safely discovers historical
  // activity once and retries any records left behind by a transient API error.
  if (isAirtableBlastSyncEnabled()) {
    backfillAirtableBlastData()
      .then(result => console.log(`[airtable-blast-sync] queued ${result.queuedBroadcasts} broadcasts and ${result.queuedResponses} responses`))
      .catch(err => console.error('[airtable-blast-sync] startup backfill failed:', err.message));
    setInterval(() => {
      runAirtableBlastSync().catch(err => console.error('[airtable-blast-sync] retry failed:', err.message));
    }, 60 * 1000).unref();
  }

  // Boot: backfill any ticks missed while the process was down
  reconcileMessageStatuses({ windowDays: 7 })
    .then(n => { if (n > 0) console.log(`[status-reconcile] boot: fixed ${n} tick(s)`); })
    .catch(err => console.error('[status-reconcile] boot error:', err.message));

  // Periodic: cheap 2-day pass every 60 s
  setInterval(async () => {
    try {
      const n = await reconcileMessageStatuses({ windowDays: 2 });
      if (n > 0) console.log(`[status-reconcile] fixed ${n} tick(s)`);
    } catch (err) {
      console.error('[status-reconcile] error:', err.message);
    }
  }, 60 * 1000).unref();

  // Expire paused automations + reap orphaned running executions
  setInterval(async () => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE coexistence.automation_executions
            SET status='error',
                error_message='Paused execution expired (no reply within timeout)',
                completed_at=NOW()
          WHERE status='paused' AND expires_at < NOW()`
      );
      if (rowCount > 0) console.log(`[sweeper] expired ${rowCount} paused execution(s)`);

      const { rowCount: orphans } = await pool.query(
        `UPDATE coexistence.automation_executions
            SET status='error',
                error_message='Execution interrupted (no completion within 15 minutes)',
                completed_at=NOW()
          WHERE status='running' AND started_at < NOW() - INTERVAL '15 minutes'`
      );
      if (orphans > 0) console.log(`[sweeper] reaped ${orphans} orphaned running execution(s)`);
    } catch (err) {
      console.error('[sweeper] error:', err.message);
    }
  }, 30 * 60 * 1000).unref();

  // Poll Meta for template approval/rejection status (only while SUBMITTED ones exist)
  const TEMPLATE_SYNC_MS = parseInt(process.env.TEMPLATE_SYNC_INTERVAL_MS || '', 10) || 10 * 60 * 1000;
  const runTemplateSync = async () => {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS pending FROM coexistence.message_templates WHERE status = 'SUBMITTED'`
      );
      if ((rows[0]?.pending || 0) === 0) return;
      const r = await syncAllAccountTemplates();
      if (r.totalUpdated > 0) console.log(`[template-sync] updated ${r.totalUpdated} template(s)`);
    } catch (err) {
      console.error('[template-sync] error:', err.message);
    }
  };
  setTimeout(runTemplateSync, 60 * 1000).unref();
  setInterval(runTemplateSync, TEMPLATE_SYNC_MS).unref();

  // Booking reminders: send the 24h-before and 1h-before WhatsApp reminders.
  // Every 5 min is fine — the 1h window is an hour wide, so a booking is caught
  // well before it starts; dedup lives in booking_events so re-runs are safe.
  const REMINDER_MS = parseInt(process.env.BOOKING_REMINDER_INTERVAL_MS || '', 10) || 5 * 60 * 1000;
  setInterval(() => {
    runBookingSweeps().catch(err => console.error('[booking-sweeps] error:', err.message));
  }, REMINDER_MS).unref();

  // Outbound campaign agents (Recovery / Reactivation / Collection). This tick
  // is a no-op unless an admin has ENABLED a campaign AND configured an approved
  // template — everything is gated, rate-limited, quiet-hours and opt-out aware
  // inside runOutboundCampaigns. Every 15 min is plenty for once-off nudges.
  const CAMPAIGN_MS = parseInt(process.env.OUTBOUND_CAMPAIGN_INTERVAL_MS || '', 10) || 15 * 60 * 1000;
  setInterval(() => {
    runOutboundCampaigns().catch(err => console.error('[outbound-campaigns] error:', err.message));
  }, CAMPAIGN_MS).unref();

  // Weekly Manager report: checks every 20 min whether the configured IST
  // day/hour has arrived and generates + delivers once (dedup via period_date).
  // No-op unless an admin enabled the schedule.
  const MANAGER_REPORT_MS = parseInt(process.env.MANAGER_REPORT_INTERVAL_MS || '', 10) || 20 * 60 * 1000;
  setInterval(() => {
    deliverWeeklyIfDue().catch(err => console.error('[manager-report] error:', err.message));
  }, MANAGER_REPORT_MS).unref();

  const server = app.listen(PORT, () => {
    console.log(`[ForgeChat] Backend running on port ${PORT}`);
  });

  const shutdown = async (sig) => {
    console.log(`[ForgeChat] ${sig} received, draining…`);
    server.close(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch(err => {
  console.error('[Fatal] Failed to start:', err.message);
  process.exit(1);
});
