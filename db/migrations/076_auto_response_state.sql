-- 076: durable, explainable classification state for WhatsApp autoresponses.
-- The tag remains the operator-facing marker; these fields are the machine state.
ALTER TABLE coexistence.contacts
  ADD COLUMN IF NOT EXISTS auto_response_detected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_response_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_response_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_auto_response
  ON coexistence.contacts (wa_number, auto_response_detected)
  WHERE auto_response_detected = TRUE;
