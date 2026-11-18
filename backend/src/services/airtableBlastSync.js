// Mirrors ForgeChat broadcasts and related inbound replies into the manager's
// Airtable base. The PostgreSQL sync log is the source of truth for retries and
// prevents duplicate rows when a process restarts or a backfill is rerun.

const pool = require('../db');

const AIRTABLE_BASE_ID = 'appqa8ATKIwJ9sUw2';
const RECIPIENTS_TABLE_ID = 'tbl5obTRiQzyF30Bk';
const RESPONSES_TABLE_ID = 'tblP5LzW1bvN2hGrX';

const RECIPIENT_FIELDS = {
  name: 'fldRZwPAkhNBKIxRz',
  companyName: 'fldmqJUL0kAR1Vr7C',
  phoneNumber: 'fldDQyodpPEaYEnvE',
  broadcastNumber: 'fldIY5PkdgnzLxQjD',
  messageBlasted: 'fldhMMTuQ9C6yHsTy',
  blastDate: 'fldug8h2ZX1u6VFJz',
  sourceId: 'fldkRzzHYJ6nTFjKQ',
};

const RESPONSE_FIELDS = {
  name: 'fld4xkW1tlf8hDgGN',
  companyName: 'fldREmOGmXfWRoA7b',
  phoneNumber: 'fld707f79FifXvra6',
  blastResponse: 'fld4iP9e2yzWKeHLd',
  responseDate: 'fldc27vzh4qPe8kzP',
  sourceId: 'fldIBqLRjUUadOcyw',
};

let running = false;
let scheduled = false;

function isEnabled() {
  return process.env.AIRTABLE_BLAST_SYNC_ENABLED === 'true'
    && Boolean(process.env.AIRTABLE_BLAST_SYNC_TOKEN);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function airtableUrl(tableId) {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`;
}

async function upsertAirtableRecord(tableId, sourceFieldId, fields) {
  const response = await fetch(airtableUrl(tableId), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_BLAST_SYNC_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: [sourceFieldId] },
      records: [{ fields }],
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${body.slice(0, 400)}`);
  return JSON.parse(body).records?.[0];
}

async function queueSource(sourceType, sourceId) {
  if (!isEnabled()) return false;
  await pool.query(
    `INSERT INTO coexistence.airtable_blast_sync_log (source_type, source_id)
     VALUES ($1, $2)
     ON CONFLICT (source_type, source_id) DO NOTHING`,
    [sourceType, String(sourceId)]
  );
  scheduleSync();
  return true;
}

async function queueBroadcastRecipient(broadcastLogId) {
  return queueSource('broadcast_log', broadcastLogId);
}

async function queueInboundResponse(messageId) {
  if (!isEnabled()) return false;
  // Keep the response table focused on blast replies, not every inbound chat.
  const { rows } = await pool.query(
    `SELECT 1
       FROM coexistence.chat_history ch
      WHERE ch.message_id = $1
        AND ch.direction = 'incoming'
        AND EXISTS (
          SELECT 1
            FROM coexistence.broadcast_logs bl
            JOIN coexistence.broadcasts b ON b.id = bl.broadcast_id
           WHERE bl.action = 'BROADCAST'
             AND bl.wa_message_id IS NOT NULL
             AND regexp_replace(bl.sent_to, '\\D', '', 'g') = ch.contact_number
             AND regexp_replace(b.from_number, '\\D', '', 'g') = ch.wa_number
             AND bl.sent_at <= ch.timestamp
        )`,
    [messageId]
  );
  if (!rows.length) return false;
  return queueSource('incoming_message', messageId);
}

const companyNameSql = `COALESCE(
  c.custom_fields ->> 'companyName',
  c.custom_fields ->> 'company_name',
  c.custom_fields ->> 'Company Name',
  company_field.value,
  ''
)`;

const companyJoinSql = `LEFT JOIN LATERAL (
  SELECT c.custom_fields ->> d.id AS value
    FROM coexistence.contact_field_definitions d
   WHERE lower(d.name) IN ('company', 'company name', 'organization', 'organisation')
     AND COALESCE(c.custom_fields ->> d.id, '') <> ''
   ORDER BY d.sort_order, d.name
   LIMIT 1
) company_field ON TRUE`;

async function loadBroadcastRecipient(sourceId) {
  const { rows } = await pool.query(
    `SELECT bl.id, bl.sent_at, b.from_number,
            COALESCE(
              NULLIF(ch.message_body, ''), NULLIF(b.body, ''), NULLIF(b.caption, ''),
              NULLIF(b.url, ''), NULLIF(t.body, ''),
              CASE WHEN t.name IS NOT NULL THEN 'Template: ' || t.name ELSE 'Broadcast message' END
            ) AS message_body,
            COALESCE(c.name, c.profile_name, '') AS name,
            ${companyNameSql} AS company_name,
            regexp_replace(bl.sent_to, '\\D', '', 'g') AS contact_number
       FROM coexistence.broadcast_logs bl
       JOIN coexistence.broadcasts b ON b.id = bl.broadcast_id
       LEFT JOIN coexistence.message_templates t ON t.id = b.template_id
       LEFT JOIN coexistence.chat_history ch ON ch.message_id = bl.wa_message_id
       LEFT JOIN coexistence.contacts c
         ON regexp_replace(c.wa_number, '\\D', '', 'g') = regexp_replace(b.from_number, '\\D', '', 'g')
        AND regexp_replace(c.contact_number, '\\D', '', 'g') = regexp_replace(bl.sent_to, '\\D', '', 'g')
       ${companyJoinSql}
      WHERE bl.id = $1
        AND bl.action = 'BROADCAST'
        AND bl.wa_message_id IS NOT NULL`,
    [sourceId]
  );
  return rows[0] || null;
}

async function loadInboundResponse(sourceId) {
  const { rows } = await pool.query(
    `SELECT ch.message_id, ch.timestamp, ch.message_body, ch.contact_number,
            COALESCE(c.name, c.profile_name, '') AS name,
            ${companyNameSql} AS company_name
       FROM coexistence.chat_history ch
       LEFT JOIN coexistence.contacts c
         ON c.wa_number = ch.wa_number AND c.contact_number = ch.contact_number
       ${companyJoinSql}
      WHERE ch.message_id = $1 AND ch.direction = 'incoming'`,
    [sourceId]
  );
  return rows[0] || null;
}

async function syncRow(row) {
  let record;
  if (row.source_type === 'broadcast_log') {
    const data = await loadBroadcastRecipient(row.source_id);
    if (!data) throw new Error('Broadcast source no longer exists.');
    record = await upsertAirtableRecord(RECIPIENTS_TABLE_ID, RECIPIENT_FIELDS.sourceId, {
      [RECIPIENT_FIELDS.name]: data.name,
      [RECIPIENT_FIELDS.companyName]: data.company_name,
      [RECIPIENT_FIELDS.phoneNumber]: data.contact_number,
      [RECIPIENT_FIELDS.broadcastNumber]: data.from_number,
      [RECIPIENT_FIELDS.messageBlasted]: data.message_body || '',
      [RECIPIENT_FIELDS.blastDate]: formatDate(data.sent_at),
      [RECIPIENT_FIELDS.sourceId]: `broadcast_log:${row.source_id}`,
    });
  } else {
    const data = await loadInboundResponse(row.source_id);
    if (!data) throw new Error('Incoming response source no longer exists.');
    record = await upsertAirtableRecord(RESPONSES_TABLE_ID, RESPONSE_FIELDS.sourceId, {
      [RESPONSE_FIELDS.name]: data.name,
      [RESPONSE_FIELDS.companyName]: data.company_name,
      [RESPONSE_FIELDS.phoneNumber]: data.contact_number,
      [RESPONSE_FIELDS.blastResponse]: data.message_body || '',
      [RESPONSE_FIELDS.responseDate]: formatDate(data.timestamp),
      [RESPONSE_FIELDS.sourceId]: `incoming_message:${row.source_id}`,
    });
  }
  await pool.query(
    `UPDATE coexistence.airtable_blast_sync_log
        SET status = 'synced', airtable_record_id = $1, synced_at = NOW(),
            last_error = NULL, updated_at = NOW()
      WHERE id = $2`,
    [record?.id || null, row.id]
  );
}

async function markFailed(row, err) {
  await pool.query(
    `UPDATE coexistence.airtable_blast_sync_log
        SET status = 'failed', attempts = attempts + 1, last_error = $1,
            next_attempt_at = NOW() + (LEAST(attempts + 1, 60) * INTERVAL '1 minute'),
            updated_at = NOW()
      WHERE id = $2`,
    [String(err.message || err).slice(0, 500), row.id]
  );
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runAirtableBlastSync({ limit = 100 } = {}) {
  if (!isEnabled() || running) return { processed: 0, skipped: true };
  running = true;
  let processed = 0;
  try {
    // A process may die between claiming a row and receiving Airtable's reply.
    // Release only stale claims; active workers remain exclusively responsible.
    await pool.query(
      `UPDATE coexistence.airtable_blast_sync_log
          SET status = 'failed', next_attempt_at = NOW(), updated_at = NOW()
        WHERE status = 'processing'
          AND updated_at < NOW() - INTERVAL '10 minutes'`
    );
    const { rows } = await pool.query(
      `UPDATE coexistence.airtable_blast_sync_log
          SET status = 'processing', updated_at = NOW()
        WHERE id IN (
          SELECT id FROM coexistence.airtable_blast_sync_log
           WHERE status IN ('pending', 'failed') AND next_attempt_at <= NOW()
           ORDER BY id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
      [limit]
    );
    for (const row of rows) {
      try {
        await syncRow(row);
        processed++;
      } catch (err) {
        await markFailed(row, err);
        console.error(`[airtable-blast-sync] ${row.source_type}:${row.source_id} failed: ${err.message}`);
      }
      // Airtable permits five API requests per second per base.
      await pause(230);
    }
    return { processed, attempted: rows.length };
  } finally {
    running = false;
  }
}

function scheduleSync() {
  if (scheduled || !isEnabled()) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    runAirtableBlastSync().catch(err => console.error('[airtable-blast-sync] run failed:', err.message));
  });
}

async function backfillAirtableBlastData({ drain = false } = {}) {
  if (!isEnabled()) throw new Error('Airtable blast sync is disabled. Set AIRTABLE_BLAST_SYNC_ENABLED=true and AIRTABLE_BLAST_SYNC_TOKEN.');
  const outbound = await pool.query(
    `INSERT INTO coexistence.airtable_blast_sync_log (source_type, source_id)
     SELECT 'broadcast_log', bl.id::text
       FROM coexistence.broadcast_logs bl
      WHERE bl.action = 'BROADCAST' AND bl.wa_message_id IS NOT NULL
     ON CONFLICT (source_type, source_id) DO UPDATE
       SET status = CASE WHEN coexistence.airtable_blast_sync_log.status = 'failed' THEN 'pending'
                         ELSE coexistence.airtable_blast_sync_log.status END,
           next_attempt_at = CASE WHEN coexistence.airtable_blast_sync_log.status = 'failed' THEN NOW()
                                  ELSE coexistence.airtable_blast_sync_log.next_attempt_at END,
           updated_at = NOW()`
  );
  const inbound = await pool.query(
    `INSERT INTO coexistence.airtable_blast_sync_log (source_type, source_id)
     SELECT 'incoming_message', ch.message_id
       FROM coexistence.chat_history ch
      WHERE ch.direction = 'incoming'
        AND EXISTS (
          SELECT 1 FROM coexistence.broadcast_logs bl
          JOIN coexistence.broadcasts b ON b.id = bl.broadcast_id
           WHERE bl.action = 'BROADCAST' AND bl.wa_message_id IS NOT NULL
             AND regexp_replace(bl.sent_to, '\\D', '', 'g') = ch.contact_number
             AND regexp_replace(b.from_number, '\\D', '', 'g') = ch.wa_number
             AND bl.sent_at <= ch.timestamp
        )
     ON CONFLICT (source_type, source_id) DO UPDATE
       SET status = CASE WHEN coexistence.airtable_blast_sync_log.status = 'failed' THEN 'pending'
                         ELSE coexistence.airtable_blast_sync_log.status END,
           next_attempt_at = CASE WHEN coexistence.airtable_blast_sync_log.status = 'failed' THEN NOW()
                                  ELSE coexistence.airtable_blast_sync_log.next_attempt_at END,
           updated_at = NOW()`
  );
  if (!drain) {
    scheduleSync();
    return { queuedBroadcasts: outbound.rowCount, queuedResponses: inbound.rowCount };
  }
  let processed = 0;
  while (true) {
    const result = await runAirtableBlastSync({ limit: 100 });
    processed += result.processed;
    if (!result.attempted) break;
  }
  return { queuedBroadcasts: outbound.rowCount, queuedResponses: inbound.rowCount, processed };
}

module.exports = {
  backfillAirtableBlastData,
  formatDate,
  isEnabled,
  queueBroadcastRecipient,
  queueInboundResponse,
  runAirtableBlastSync,
};
