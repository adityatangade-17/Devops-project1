// Run after configuring the Airtable environment variables to export all
// existing ForgeChat broadcasts and subsequent incoming replies.
require('dotenv').config();

const pool = require('../src/db');
const { backfillAirtableBlastData } = require('../src/services/airtableBlastSync');

backfillAirtableBlastData({ drain: true })
  .then(result => {
    console.log(`[airtable-blast-sync] queued ${result.queuedBroadcasts} broadcasts and ${result.queuedResponses} responses; synced ${result.processed}.`);
  })
  .catch(err => {
    console.error('[airtable-blast-sync] backfill failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
