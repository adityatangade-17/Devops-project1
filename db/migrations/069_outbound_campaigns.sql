-- 069: Outbound campaign agents (Recovery / Reactivation / Collection).
--
-- These are the Phase-2 proactive agents that MESSAGE customers who did not just
-- write in. On WhatsApp that can only be a business-initiated, Meta-approved
-- TEMPLATE, so everything here is built to be ban-safe:
--   * ships DISABLED (enabled = FALSE) — nothing sends until an admin turns it on
--   * TEMPLATE-GATED — a campaign with no template_name is skipped, never guesses
--   * RATE-LIMITED — per-run cap, per-day cap, and a per-contact minimum gap
--   * QUIET-HOURS — no sends in the configured IST night window
--   * OPT-OUT AWARE — contacts.marketing_opted_out excludes a person permanently
--
-- Single-tenant, matching the rest of `coexistence`: one config row per kind.

/* --------------------------- per-contact opt-out --------------------------- */
ALTER TABLE coexistence.contacts
  ADD COLUMN IF NOT EXISTS marketing_opted_out    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_opted_out_at TIMESTAMPTZ;

/* ------------------------------ campaign config ---------------------------- */
CREATE TABLE IF NOT EXISTS coexistence.outbound_campaigns (
  id                 BIGSERIAL PRIMARY KEY,
  kind               TEXT NOT NULL UNIQUE
                       CHECK (kind IN ('recovery','reactivation','collection')),
  enabled            BOOLEAN NOT NULL DEFAULT FALSE,   -- ships OFF
  -- Which WhatsApp number sends. For recovery/reactivation we can fall back to
  -- the number the contact originally messaged; collection bookings have no wa
  -- number, so a wa_account_id is required there.
  wa_account_id      BIGINT REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL,
  -- The Meta-approved template to send. NULL => campaign is skipped (gated).
  template_name      TEXT,
  template_language  TEXT NOT NULL DEFAULT 'en',
  -- Audience shaping.
  stale_days         INT  NOT NULL DEFAULT 14   CHECK (stale_days BETWEEN 1 AND 3650),
  audience_tag       TEXT,                       -- optional tag filter (reactivation segments)
  -- Rate limits / safety.
  max_per_run        INT  NOT NULL DEFAULT 50    CHECK (max_per_run BETWEEN 1 AND 1000),
  max_per_day        INT  NOT NULL DEFAULT 200   CHECK (max_per_day BETWEEN 1 AND 10000),
  min_gap_days       INT  NOT NULL DEFAULT 30    CHECK (min_gap_days BETWEEN 1 AND 3650),
  quiet_start_hour   INT  NOT NULL DEFAULT 21    CHECK (quiet_start_hour BETWEEN 0 AND 23),
  quiet_end_hour     INT  NOT NULL DEFAULT 9     CHECK (quiet_end_hour BETWEEN 0 AND 23),
  updated_by         BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed one disabled config per kind so the admin only ever edits.
INSERT INTO coexistence.outbound_campaigns (kind, stale_days, min_gap_days)
VALUES
  ('recovery',      14, 21),   -- engaged then went quiet ~2 weeks
  ('reactivation',  90, 60),   -- aged database, ~3 months cold
  ('collection',     3,  7)    -- payment pending, chase after a few days
ON CONFLICT (kind) DO NOTHING;

/* ------------------------------- send log ---------------------------------- */
-- One row per attempted send. Drives dedup, the per-contact minimum gap, and the
-- per-day cap; also a full audit trail of who was messaged, when, with what.
CREATE TABLE IF NOT EXISTS coexistence.outbound_sends (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,
  wa_number       TEXT,                    -- our sending number (normalized)
  contact_number  TEXT NOT NULL,           -- recipient (normalized)
  template_name   TEXT,
  booking_id      BIGINT REFERENCES coexistence.bookings(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent','failed','skipped')),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The gap / daily-cap queries filter by contact + recency and by kind + day.
CREATE INDEX IF NOT EXISTS idx_outbound_sends_contact
  ON coexistence.outbound_sends(contact_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_sends_kind_day
  ON coexistence.outbound_sends(kind, created_at DESC);
