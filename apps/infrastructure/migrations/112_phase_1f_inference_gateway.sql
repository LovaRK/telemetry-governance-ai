-- Phase 1F: Inferencing Gateway & Multi-Tier Runtime Audit Ledger

ALTER TABLE llm_health_history
  ADD COLUMN IF NOT EXISTS resolved_topology_tier VARCHAR(32),
  ADD COLUMN IF NOT EXISTS active_endpoint_url VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'llm_health_history_resolved_topology_tier_check'
  ) THEN
    ALTER TABLE llm_health_history
      ADD CONSTRAINT llm_health_history_resolved_topology_tier_check
      CHECK (resolved_topology_tier IS NULL OR resolved_topology_tier IN ('HOST', 'CONTAINER', 'CLOUD', 'UNREACHABLE'));
  END IF;
END $$;

ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS execution_topology_tier VARCHAR(32),
  ADD COLUMN IF NOT EXISTS targeted_model_digest VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_decisions_execution_topology_tier_check'
  ) THEN
    ALTER TABLE agent_decisions
      ADD CONSTRAINT agent_decisions_execution_topology_tier_check
      CHECK (execution_topology_tier IS NULL OR execution_topology_tier IN ('HOST', 'CONTAINER', 'CLOUD'));
  END IF;
END $$;

