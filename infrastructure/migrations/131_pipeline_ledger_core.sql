-- Ensure core pipeline ledger tables exist before RLS policies (202) are applied.
-- This migration is idempotent and safe on existing environments.

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
  pipeline_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  model_version VARCHAR(64) NOT NULL DEFAULT 'gemma2:9b',
  prompt_version VARCHAR(32) NOT NULL DEFAULT '2.0',
  splunk_query_version VARCHAR(32) NOT NULL DEFAULT '1.0',
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
  error_message TEXT,
  error_type VARCHAR(50),
  error_code VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS tenant_snapshot_pointer (
  tenant_id VARCHAR(64) PRIMARY KEY,
  active_run_id UUID NOT NULL REFERENCES pipeline_runs(run_id),
  active_snapshot_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_started ON pipeline_runs(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_published ON pipeline_runs(tenant_id, published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_run_stage ON pipeline_stage_events(run_id, stage, started_at DESC);

