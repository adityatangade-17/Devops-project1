-- 067: Tag each booking service with an office (WhatsApp number) for the
-- franchise model. NULL = global/unassigned (visible to admins only until an
-- admin assigns an office). A non-admin sees only services — and therefore
-- bookings — whose office is one of their granted WhatsApp numbers
-- (user_wa_assignments). Digits-only, matching whatsapp_accounts.display_phone_number
-- and user_wa_assignments.wa_number.

ALTER TABLE coexistence.booking_services
  ADD COLUMN IF NOT EXISTS wa_number TEXT;

CREATE INDEX IF NOT EXISTS idx_booking_services_wa ON coexistence.booking_services(wa_number);
