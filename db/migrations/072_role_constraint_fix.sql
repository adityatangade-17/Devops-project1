-- 072: HOTFIX — allow the team_lead and consultant roles at the database level.
--
-- Migration 031 pinned the role CHECK constraint to ('admin','bda_sales','viewer').
-- Later work (068) introduced 'team_lead' and 'consultant' in the app layer
-- (permissions.js), but the DB constraint was never widened — so changing a
-- user's role to team_lead/consultant failed with a check-constraint violation.
-- This aligns the constraint with the app's VALID_ROLES.
ALTER TABLE coexistence.forgecrm_users
  DROP CONSTRAINT IF EXISTS forgecrm_users_role_check;
ALTER TABLE coexistence.forgecrm_users
  ADD CONSTRAINT forgecrm_users_role_check
  CHECK (role IN ('admin','team_lead','bda_sales','consultant','viewer'));
