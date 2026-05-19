-- Migration 108: Idempotent ingestion constraints
-- Prevents duplicate snapshots, KPIs, and decisions on re-runs
-- Uses ON CONFLICT DO NOTHING / DO UPDATE at the application layer

BEGIN;

-- 1. Unique snapshot per (date, index_name, tenant_id)
--    Deduplicates re-runs triggered by "Connect & Refresh" clicks
ALTER TABLE telemetry_snapshots
  ADD CONSTRAINT uq_snapshot_date_index_tenant
  UNIQUE (snapshot_date, index_name, tenant_id);

-- 2. Unique KPI per snapshot
--    Already has snapshot_id FK — make it truly unique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_executive_kpis_snapshot'
  ) THEN
    ALTER TABLE executive_kpis
      ADD CONSTRAINT uq_executive_kpis_snapshot
      UNIQUE (snapshot_id);
  END IF;
END $$;

-- 3. Unique decision per (snapshot_id, index_name, sourcetype)
--    Prevents LLM re-runs from creating duplicate decision rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_agent_decision_snapshot_index'
  ) THEN
    ALTER TABLE agent_decisions
      ADD CONSTRAINT uq_agent_decision_snapshot_index
      UNIQUE (snapshot_id, index_name, sourcetype);
  END IF;
END $$;

-- 4. Unique job per (snapshot_id, job_type) to prevent duplicate LLM queue entries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_job_queue_snapshot_type'
  ) THEN
    ALTER TABLE job_queue
      ADD CONSTRAINT uq_job_queue_snapshot_type
      UNIQUE (snapshot_id, job_type);
  END IF;
END $$;

COMMIT;
