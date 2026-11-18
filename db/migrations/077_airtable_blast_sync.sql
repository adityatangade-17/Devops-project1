-- Tracks Airtable exports independently from WhatsApp delivery. A unique source
-- key makes both historical backfills and retry attempts safe to run repeatedly.
CREATE TABLE IF NOT EXISTS coexistence.airtable_blast_sync_log (
  id                  BIGSERIAL PRIMARY KEY,
  source_type         TEXT NOT NULL CHECK (source_type IN ('broadcast_log', 'incoming_message')),
  source_id           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
  airtable_record_id  TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_airtable_blast_sync_pending
  ON coexistence.airtable_blast_sync_log (status, next_attempt_at, id);
