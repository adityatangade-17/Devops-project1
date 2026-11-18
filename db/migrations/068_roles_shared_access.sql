-- 068: Consultant↔user link, shared per-contact access, and team-lead hierarchy.
--
-- * booking_consultants.user_id — a consultant IS a ForgeCRM user (they chat with
--   the customers they meet). Links the consultant record to that login.
-- * contact_user_access — grants a specific user access to a specific customer
--   conversation IN ADDITION TO the contact's owner (assigned_user_id). Used when
--   a consultant is booked with a customer: both the original owner and the
--   consultant can then see and reply in that chat.
-- * team_lead_members — which users report to a team lead. A team lead inherits
--   the visibility (chats/contacts) of every member assigned to them.

ALTER TABLE coexistence.booking_consultants
  ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_booking_consultants_user ON coexistence.booking_consultants(user_id);

CREATE TABLE IF NOT EXISTS coexistence.contact_user_access (
  wa_number      TEXT   NOT NULL,
  contact_number TEXT   NOT NULL,
  user_id        BIGINT NOT NULL REFERENCES coexistence.forgecrm_users(id) ON DELETE CASCADE,
  granted_by     BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wa_number, contact_number, user_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_user_access_user ON coexistence.contact_user_access(user_id);

CREATE TABLE IF NOT EXISTS coexistence.team_lead_members (
  lead_id    BIGINT NOT NULL REFERENCES coexistence.forgecrm_users(id) ON DELETE CASCADE,
  member_id  BIGINT NOT NULL REFERENCES coexistence.forgecrm_users(id) ON DELETE CASCADE,
  created_by BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lead_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_team_lead_members_lead ON coexistence.team_lead_members(lead_id);
