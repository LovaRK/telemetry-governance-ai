-- Phase 2 A-C: dashboard validation persistence

CREATE TABLE IF NOT EXISTS dashboard_validation_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS dashboard_validation_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES dashboard_validation_runs(run_id) ON DELETE CASCADE,
  widget_key VARCHAR(128) NOT NULL,
  expected_value NUMERIC(18,4),
  rendered_value NUMERIC(18,4),
  computed_value NUMERIC(18,4),
  reason TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_validation_runs_tenant_started
  ON dashboard_validation_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_validation_failures_run
  ON dashboard_validation_failures (run_id);

