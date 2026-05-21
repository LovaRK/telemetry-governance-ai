-- Phase 1A–1D: Immutable published-run ledger

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','RUNNING','FAILED','SUCCEEDED')),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_hash VARCHAR(64) UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  superseded_by_run_id UUID REFERENCES pipeline_runs(run_id),
  pipeline_version VARCHAR(32) NOT NULL,
  model_version VARCHAR(64) NOT NULL,
  prompt_version VARCHAR(32) NOT NULL,
  splunk_query_version VARCHAR(32) NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_stage_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  stage VARCHAR(32) NOT NULL CHECK (stage IN ('SPLUNK_FETCH','SNAPSHOT_WRITE','KPI_AGGREGATION','AI_DECISIONS','GOVERNANCE_SYNC','PUBLISH')),
  attempt INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL CHECK (status IN ('IN_PROGRESS','SUCCESS','FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_processed INT NOT NULL DEFAULT 0,
  metadata_json JSONB,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS tenant_snapshot_pointer (
  tenant_id VARCHAR(64) PRIMARY KEY,
  active_run_id UUID NOT NULL REFERENCES pipeline_runs(run_id),
  active_snapshot_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE telemetry_snapshots ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';

ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS trace_id VARCHAR(128);
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS model_version VARCHAR(64);
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32);

ALTER TABLE telemetry_snapshots DROP CONSTRAINT IF EXISTS uq_snapshot_identity;
ALTER TABLE executive_kpis DROP CONSTRAINT IF EXISTS executive_kpis_snapshot_date_key;
ALTER TABLE executive_kpis DROP CONSTRAINT IF EXISTS uq_executive_kpis_snapshot;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_snapshots_tenant_snapshot_identity') THEN
    ALTER TABLE telemetry_snapshots
    ADD CONSTRAINT uq_snapshots_tenant_snapshot_identity
    UNIQUE (tenant_id, snapshot_id, granularity, index_name, sourcetype);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_exec_kpis_tenant_snapshot') THEN
    ALTER TABLE executive_kpis
    ADD CONSTRAINT uq_exec_kpis_tenant_snapshot
    UNIQUE (tenant_id, snapshot_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_decisions_tenant_snapshot_key') THEN
    ALTER TABLE agent_decisions
    ADD CONSTRAINT uq_decisions_tenant_snapshot_key
    UNIQUE (tenant_id, snapshot_id, index_name, sourcetype);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_started ON pipeline_runs(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_published ON pipeline_runs(tenant_id, published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_run_stage ON pipeline_stage_events(run_id, stage, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_snapshot ON telemetry_snapshots(tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_kpis_tenant_snapshot ON executive_kpis(tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_decisions_tenant_snapshot ON agent_decisions(tenant_id, snapshot_id);
