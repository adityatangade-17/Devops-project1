-- 074: Guided venture setup — the workspace's business profile, offices and
-- products/services. Collected by the New Venture Setup wizard and later read by
-- AI onboarding to generate business-specific agents.

-- Single-row company profile (the workspace's business identity).
CREATE TABLE IF NOT EXISTS coexistence.venture_profile (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name     TEXT,
  legal_name       TEXT,
  gst_number       TEXT,
  business_type    TEXT,            -- Manufacturer / Importer / Trader / Service / …
  sector           TEXT,            -- e.g. EPR compliance, Healthcare, Real estate
  description      TEXT,            -- what the business does (feeds AI onboarding)
  website          TEXT,
  team_size        TEXT,            -- band, e.g. "1-10"
  contact_email    TEXT,
  contact_phone    TEXT,
  setup_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  setup_step       INT     NOT NULL DEFAULT 0,   -- furthest step index reached
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO coexistence.venture_profile (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Offices / branches, optionally tied to a WhatsApp number.
CREATE TABLE IF NOT EXISTS coexistence.venture_offices (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  city           TEXT,
  address        TEXT,
  phone          TEXT,
  wa_account_id  BIGINT REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products / services offered.
CREATE TABLE IF NOT EXISTS coexistence.venture_products (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('product','service')),
  description  TEXT,
  price_text   TEXT,           -- freeform, e.g. "₹5,000 / year"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
