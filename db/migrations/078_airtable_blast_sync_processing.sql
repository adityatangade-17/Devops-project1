-- A short-lived processing state lets concurrent workers claim different rows
-- before calling Airtable, preventing duplicate records during a backfill.
ALTER TABLE coexistence.airtable_blast_sync_log
  DROP CONSTRAINT IF EXISTS airtable_blast_sync_log_status_check;

ALTER TABLE coexistence.airtable_blast_sync_log
  ADD CONSTRAINT airtable_blast_sync_log_status_check
  CHECK (status IN ('pending', 'processing', 'synced', 'failed'));
