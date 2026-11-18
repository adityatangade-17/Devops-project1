-- 073: Tasks module + team presence.
--
-- Two manager-requested features:
--   * Presence — last_active_at, stamped (throttled) by the auth middleware so we
--     can show which team members are currently online / available.
--   * Tasks — a first-class action-item list. Tasks can be created manually, from
--     a chat, automatically by an AI agent during a conversation (source='ai'),
--     or automatically when a chat is handed to a human (source='handoff').

/* ------------------------------- presence -------------------------------- */
ALTER TABLE coexistence.forgecrm_users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

/* -------------------------------- tasks ---------------------------------- */
CREATE TABLE IF NOT EXISTS coexistence.tasks (
  id               BIGSERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','done','cancelled')),
  priority         TEXT NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low','normal','high')),
  -- Who owns the task and who created it.
  assigned_user_id BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_by       BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  -- Optional link back to the conversation that spawned it.
  wa_number        TEXT,
  contact_number   TEXT,
  contact_name     TEXT,
  due_at           TIMESTAMPTZ,
  -- How the task came to exist.
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','ai','handoff','system')),
  agent_id         BIGINT REFERENCES coexistence.agents(id) ON DELETE SET NULL,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee   ON coexistence.tasks(assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_contact    ON coexistence.tasks(wa_number, contact_number);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON coexistence.tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON coexistence.tasks(created_by);
