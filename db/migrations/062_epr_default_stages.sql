-- 062: EPR sales workflow default stages + order.
--
-- Retrofits the DEFAULT pipeline (the one seeded by 046) with the EPR team's
-- stage set and order:
--   New Lead → Qualified → Document Received → Proposal Sent → Negotiation →
--   Payment Received → Compliance in Progress → Renewal Due → Won → Lost
--
-- Non-destructive and idempotent:
--   * Existing stages are matched case-insensitively by name and repositioned
--     (New Lead / Qualified / Proposal Sent / Negotiation / Won / Lost already
--     exist from 046 and are reused, so their deals are preserved).
--   * Missing stages (Document Received, Payment Received, Compliance in
--     Progress, Renewal Due) are inserted.
--   * We NEVER delete a stage — any extra/custom stage a tenant added is simply
--     pushed to the end (position >= 100) so it keeps its deals.
-- Mirrors DEFAULT_STAGES in backend/src/routes/pipelines.js (used for NEW
-- pipelines). Only touches the default pipeline; custom pipelines are left as-is.

DO $$
DECLARE
  pid  BIGINT;
  rec  RECORD;
  want CONSTANT TEXT[][] := ARRAY[
    -- name,                     probability, stage_type, color
    ['New Lead',               '10',  'open', '#3B82F6'],
    ['Qualified',              '25',  'open', '#EAB308'],
    ['Document Received',      '40',  'open', '#06B6D4'],
    ['Proposal Sent',          '55',  'open', '#F97316'],
    ['Negotiation',            '70',  'open', '#A855F7'],
    ['Payment Received',       '85',  'open', '#14B8A6'],
    ['Compliance in Progress', '90',  'open', '#6366F1'],
    ['Renewal Due',            '60',  'open', '#F59E0B'],
    ['Won',                    '100', 'won',  '#16A34A'],
    ['Lost',                   '0',   'lost', '#DC2626']
  ];
  i INT;
  sid BIGINT;
BEGIN
  -- Resolve the default pipeline (fall back to the earliest one).
  SELECT id INTO pid FROM coexistence.pipelines
   ORDER BY is_default DESC, position ASC, id ASC
   LIMIT 1;

  IF pid IS NULL THEN
    RETURN; -- no pipelines yet; 046's seed / API create handles fresh installs
  END IF;

  -- Park every current stage out of the way first, so leftover custom stages end
  -- up after the canonical ten without ever colliding on position.
  UPDATE coexistence.pipeline_stages
     SET position = position + 1000
   WHERE pipeline_id = pid;

  FOR i IN 1 .. array_length(want, 1) LOOP
    -- Case-insensitive match on name within this pipeline.
    SELECT id INTO sid
      FROM coexistence.pipeline_stages
     WHERE pipeline_id = pid AND lower(name) = lower(want[i][1])
     ORDER BY id ASC
     LIMIT 1;

    IF sid IS NULL THEN
      INSERT INTO coexistence.pipeline_stages
        (pipeline_id, name, probability, position, stage_type, color)
      VALUES
        (pid, want[i][1], want[i][2]::int, i - 1, want[i][3], want[i][4]);
    ELSE
      UPDATE coexistence.pipeline_stages
         SET name        = want[i][1],
             probability = want[i][2]::int,
             position    = i - 1,
             stage_type  = want[i][3],
             color       = want[i][4],
             updated_at  = NOW()
       WHERE id = sid;
    END IF;
  END LOOP;

  -- Re-compact any surviving custom stages (still at +1000) to sit right after
  -- the canonical ten, preserving their relative order.
  i := array_length(want, 1);
  FOR rec IN
    SELECT id FROM coexistence.pipeline_stages
     WHERE pipeline_id = pid AND position >= 1000
     ORDER BY position ASC, id ASC
  LOOP
    UPDATE coexistence.pipeline_stages SET position = i, updated_at = NOW() WHERE id = rec.id;
    i := i + 1;
  END LOOP;
END $$;
