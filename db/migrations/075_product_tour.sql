-- 075: Per-user product-tour state. A new user is walked through the workspace
-- once; the flag persists across devices so the tour doesn't re-appear. Users can
-- replay it on demand (that path doesn't clear the flag).
ALTER TABLE coexistence.forgecrm_users
  ADD COLUMN IF NOT EXISTS tour_completed BOOLEAN NOT NULL DEFAULT FALSE;
