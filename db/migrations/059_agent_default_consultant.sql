-- 059: Per-agent default consultant for handoff routing.
--
-- All agents currently share one WhatsApp business number (wa_account_id=1),
-- so contactMutations.triggerHandoff's original fallback — "first bda_sales
-- user assigned to this wa_number" via user_wa_assignments — can't tell
-- sectors apart: every agent on that number would resolve to the same
-- consultant. Each agent (sector) now carries its own default consultant;
-- trigger_handoff prefers this over the wa_number-wide fallback.

ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS default_consultant_user_id BIGINT
    REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL;
