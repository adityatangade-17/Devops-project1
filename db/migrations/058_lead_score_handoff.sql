-- 058: Lead-scoring + human-handover support.
--
-- Lead score itself lives in contacts.custom_fields (like every other lead
-- attribute) — getFieldValue() in automationEngine.js already documents this
-- ("everything else (incl. lead_score) lives in the custom_fields JSONB").
-- What's missing structurally is:
--   * a real pause flag so the agent router can stop the AI on handoff
--   * a notify number on the user row so a handoff can WhatsApp the consultant
--   * the follow_up_logs table (referenced by jobs/followupWorker.js but never
--     migrated — it only existed on instances where someone created it by hand)

ALTER TABLE coexistence.contacts
  ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE coexistence.forgecrm_users
  ADD COLUMN IF NOT EXISTS notify_wa_number TEXT;

CREATE TABLE IF NOT EXISTS coexistence.follow_up_logs (
  id            BIGSERIAL PRIMARY KEY,
  contact_id    BIGINT NOT NULL REFERENCES coexistence.contacts(id) ON DELETE CASCADE,
  step          INT NOT NULL,
  template_name TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, step)
);
CREATE INDEX IF NOT EXISTS idx_follow_up_logs_contact ON coexistence.follow_up_logs(contact_id);
