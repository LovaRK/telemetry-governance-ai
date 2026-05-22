BEGIN;

CREATE TABLE IF NOT EXISTS kpi_change_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  kpi_name VARCHAR(64) NOT NULL,
  old_value NUMERIC NOT NULL,
  new_value NUMERIC NOT NULL,
  delta NUMERIC NOT NULL,
  formula_version VARCHAR(32) NOT NULL,
  source_origin VARCHAR(64) NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  snapshot_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kpi_change_events_tenant_kpi_created
  ON kpi_change_events (tenant_id, kpi_name, created_at DESC);

COMMIT;
