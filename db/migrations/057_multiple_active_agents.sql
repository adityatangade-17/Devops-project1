-- Allow more than one active agent per WhatsApp account so a keyword-triggered
-- agent (e.g. CEPC) can run alongside the catch-all 'any' agent (e.g. EPR
-- Assistant). The router (agentRouter.js) now picks by priority:
--   1) a keyword agent whose keyword matches the message,
--   2) a keyword agent with a live session for this contact,
--   3) the 'any' agent.
DROP INDEX IF EXISTS coexistence.idx_agents_one_active_per_account;
