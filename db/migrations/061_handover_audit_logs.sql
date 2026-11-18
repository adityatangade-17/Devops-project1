-- 061: Handover audit logging table for AI agents and human transfer lifecycle.
CREATE TABLE IF NOT EXISTS coexistence.agent_handovers (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT REFERENCES coexistence.agents(id) ON DELETE SET NULL,
  knowledge_base_id BIGINT REFERENCES coexistence.knowledge_bases(id) ON DELETE SET NULL,
  wa_number TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  assigned_user_id BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  reason TEXT,
  retrieval_score NUMERIC(4,3),
  customer_message_sent TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','resolved')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_handovers_contact ON coexistence.agent_handovers (wa_number, contact_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_handovers_assigned ON coexistence.agent_handovers (assigned_user_id, status);
