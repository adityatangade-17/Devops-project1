-- 071: Weekly Manager report auto-delivery.
--
-- The Manager agent already produces an on-demand digest (services/managerReport.js
-- + GET /agents/manager-report). This adds an optional WEEKLY schedule: on the
-- configured IST day/hour the backend generates the digest, records it, and
-- best-effort delivers it to the configured WhatsApp recipients (internal staff).
--
-- Ships DISABLED — nothing is generated or sent until an admin turns it on.
-- Single-tenant: one config row.

CREATE TABLE IF NOT EXISTS coexistence.manager_report_config (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- single row
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  day_of_week    INT NOT NULL DEFAULT 1  CHECK (day_of_week BETWEEN 1 AND 7),  -- ISO: 1=Mon..7=Sun
  hour           INT NOT NULL DEFAULT 9  CHECK (hour BETWEEN 0 AND 23),        -- IST hour
  window_days    INT NOT NULL DEFAULT 7  CHECK (window_days BETWEEN 1 AND 90),
  wa_account_id  BIGINT REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL,
  recipients     JSONB NOT NULL DEFAULT '[]'::jsonb,          -- array of WhatsApp numbers (staff)
  updated_by     BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO coexistence.manager_report_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- One row per generated report. The UNIQUE period_date guarantees the weekly
-- job fires at most once on its scheduled day even if the tick runs repeatedly.
CREATE TABLE IF NOT EXISTS coexistence.manager_report_runs (
  id            BIGSERIAL PRIMARY KEY,
  period_date   DATE NOT NULL UNIQUE,     -- IST date the report was generated for
  digest        TEXT,
  metrics       JSONB,
  delivered_to  INT NOT NULL DEFAULT 0,   -- how many recipients we sent to
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_report_runs_created ON coexistence.manager_report_runs(created_at DESC);
