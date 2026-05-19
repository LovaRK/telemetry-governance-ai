-- Migration 117: Deduplicate agent_decisions and enforce unique constraint
-- Ensures ON CONFLICT (snapshot_id, index_name, sourcetype) works correctly in upsertAgentDecision

-- Step 1: Remove duplicate rows — keep the row with the highest id (most recent upsert)
DELETE FROM agent_decisions a
WHERE a.id NOT IN (
  SELECT MAX(id)
  FROM agent_decisions
  GROUP BY snapshot_id, index_name, COALESCE(sourcetype, '')
);

-- Step 2: Add unique constraint if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_agent_decision_identity'
      AND conrelid = 'agent_decisions'::regclass
  ) THEN
    ALTER TABLE agent_decisions
      ADD CONSTRAINT uq_agent_decision_identity
      UNIQUE (snapshot_id, index_name, sourcetype);
  END IF;
END;
$$;
