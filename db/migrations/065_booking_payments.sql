-- 065: Booking payments (Phase 3, behind a provider adapter).
--
-- Adds a per-service payment policy + price, a payment_status on each booking,
-- and payment_intents / payments tables. The booking flow honours the policy;
-- actual money movement goes through a provider adapter (services/paymentProvider.js)
-- whose MOCK implementation auto-succeeds so the flow is fully testable before a
-- real gateway (e.g. Razorpay) is connected. No live charges happen in mock mode.

ALTER TABLE coexistence.booking_services
  ADD COLUMN IF NOT EXISTS payment_policy TEXT NOT NULL DEFAULT 'free'
    CHECK (payment_policy IN ('free','full_payment_required','deposit_required','pay_later','manual_approval')),
  ADD COLUMN IF NOT EXISTS price_minor   INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  ADD COLUMN IF NOT EXISTS deposit_minor INTEGER NOT NULL DEFAULT 0 CHECK (deposit_minor >= 0),
  ADD COLUMN IF NOT EXISTS currency      TEXT    NOT NULL DEFAULT 'INR';

ALTER TABLE coexistence.bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required','due','pending','paid','failed','refunded')),
  ADD COLUMN IF NOT EXISTS amount_minor  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency      TEXT    NOT NULL DEFAULT 'INR';

CREATE TABLE IF NOT EXISTS coexistence.payment_intents (
  id                 BIGSERIAL PRIMARY KEY,
  booking_id         BIGINT REFERENCES coexistence.bookings(id) ON DELETE CASCADE,
  provider           TEXT   NOT NULL,
  provider_intent_id TEXT,
  amount_minor       INTEGER NOT NULL,
  currency           TEXT   NOT NULL DEFAULT 'INR',
  status             TEXT   NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','succeeded','failed','expired')),
  checkout_url       TEXT,
  idempotency_key    TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_booking ON coexistence.payment_intents(booking_id);

CREATE TABLE IF NOT EXISTS coexistence.payments (
  id                  BIGSERIAL PRIMARY KEY,
  booking_id          BIGINT REFERENCES coexistence.bookings(id) ON DELETE CASCADE,
  provider            TEXT   NOT NULL,
  provider_payment_id TEXT,
  amount_minor        INTEGER NOT NULL,
  currency            TEXT   NOT NULL DEFAULT 'INR',
  status              TEXT   NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','failed','refunded','partially_refunded')),
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON coexistence.payments(booking_id);
