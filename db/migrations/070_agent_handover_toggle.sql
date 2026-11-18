-- 070: Per-agent human-handover toggle.
--
-- Lets an admin turn automatic "transfer to a human" on or off for each AI agent.
-- When OFF, the agent never escalates: the trigger_handoff tool is not offered
-- to the model, and the KB-less/strict grounding path no longer force-transfers.
--
-- Defaults TRUE to preserve existing behaviour for agents that relied on it.
ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS human_handover_enabled BOOLEAN NOT NULL DEFAULT TRUE;
