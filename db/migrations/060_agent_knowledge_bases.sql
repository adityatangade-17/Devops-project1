-- 060: Approved, per-sector knowledge bases for grounded AI agents.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS coexistence.knowledge_bases (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT 'General',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coexistence.knowledge_documents (
  id BIGSERIAL PRIMARY KEY,
  knowledge_base_id BIGINT NOT NULL REFERENCES coexistence.knowledge_bases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed','archived')),
  error_message TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_base_id, sha256)
);

CREATE TABLE IF NOT EXISTS coexistence.knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES coexistence.knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_base ON coexistence.knowledge_documents(knowledge_base_id, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON coexistence.knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS knowledge_base_id BIGINT REFERENCES coexistence.knowledge_bases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grounding_mode TEXT NOT NULL DEFAULT 'strict' CHECK (grounding_mode IN ('strict','assistive')),
  ADD COLUMN IF NOT EXISTS retrieval_min_score NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  ADD COLUMN IF NOT EXISTS retrieval_max_chunks INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS default_consultant_user_id BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handover_message TEXT NOT NULL DEFAULT 'Thank you. This needs a specialist review, so I am connecting you with our team. You can call {{consultant_phone}} for immediate assistance.';
