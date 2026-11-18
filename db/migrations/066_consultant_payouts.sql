-- 066: Consultant payouts foundation (Phase 3, behind the mock payment provider).
--
-- Tracks what each consultant has earned from PAID bookings and lets an admin
-- settle the available balance. Money movement is mock until a real payout
-- provider + KYC are connected (spec §11B requires that before live payouts).
--
-- Model (kept intentionally simple for the MVP — not full double-entry): one
-- ledger row per booking earning, whose status walks
--   pending  -> available   (consultation completed)
--            -> reversed     (booking cancelled/refunded)
--   available -> paid        (settled in a payout)

-- Per-consultant commission config (a lightweight stand-in for the spec's full
-- compensation-rules engine; sufficient for single-tenant use).
ALTER TABLE coexistence.booking_consultants
  ADD COLUMN IF NOT EXISTS commission_type        TEXT NOT NULL DEFAULT 'none'
    CHECK (commission_type IN ('none','fixed','percentage')),
  ADD COLUMN IF NOT EXISTS commission_fixed_minor INTEGER NOT NULL DEFAULT 0 CHECK (commission_fixed_minor >= 0),
  ADD COLUMN IF NOT EXISTS commission_bps         INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000);

CREATE TABLE IF NOT EXISTS coexistence.consultant_payouts (
  id                 BIGSERIAL PRIMARY KEY,
  consultant_id      BIGINT NOT NULL REFERENCES coexistence.booking_consultants(id) ON DELETE CASCADE,
  provider           TEXT   NOT NULL DEFAULT 'mock',
  provider_payout_id TEXT,
  amount_minor       INTEGER NOT NULL,
  currency           TEXT   NOT NULL DEFAULT 'INR',
  status             TEXT   NOT NULL DEFAULT 'paid' CHECK (status IN ('requested','processing','paid','failed')),
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consultant_payouts_consultant ON coexistence.consultant_payouts(consultant_id);

CREATE TABLE IF NOT EXISTS coexistence.consultant_ledger_entries (
  id            BIGSERIAL PRIMARY KEY,
  consultant_id BIGINT NOT NULL REFERENCES coexistence.booking_consultants(id) ON DELETE CASCADE,
  booking_id    BIGINT REFERENCES coexistence.bookings(id) ON DELETE SET NULL,
  payout_id     BIGINT REFERENCES coexistence.consultant_payouts(id) ON DELETE SET NULL,
  amount_minor  INTEGER NOT NULL,
  currency      TEXT   NOT NULL DEFAULT 'INR',
  status        TEXT   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','reversed','paid')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_consultant ON coexistence.consultant_ledger_entries(consultant_id, status);
CREATE INDEX IF NOT EXISTS idx_ledger_booking    ON coexistence.consultant_ledger_entries(booking_id);
