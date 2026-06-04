-- Migration 205: Scoring-decision audit trail
--
-- Every recommendation produced by the analytics engine (1stmile CSV pipeline
-- or Splunk Refresh pipeline) generates exactly one audit record here.
-- This table provides decision traceability:
--
--   sourcetype → scores → tier → recommendation → audit record
--
-- Distinct from governance_engine_audit_events (future) which tracks
-- policy ALLOW/DENY decisions from the runtime governance engine.
-- RLS-enabled: tenants can only read their own audit records.

CREATE TABLE IF NOT EXISTS governance_audit_events (
  audit_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  snapshot_id     UUID        NOT NULL,
  sourcetype      TEXT        NOT NULL,
  index_name      TEXT,
  composite_score NUMERIC(10,2),
  utilization_score NUMERIC(10,2),
  detection_score NUMERIC(10,2),
  quality_score   NUMERIC(10,2),
  tier            TEXT        NOT NULL CHECK (tier IN ('Critical','Important','Nice-to-Have','Wasteful')),
  recommendation  TEXT        NOT NULL,
  decision_source TEXT        NOT NULL DEFAULT 'csv_analytics',
  reasoning       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by tenant + snapshot (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_gae_tenant_snapshot
  ON governance_audit_events (tenant_id, snapshot_id);

-- Lookup by sourcetype for lineage queries
CREATE INDEX IF NOT EXISTS idx_gae_sourcetype
  ON governance_audit_events (tenant_id, sourcetype);

-- Chronological audit log
CREATE INDEX IF NOT EXISTS idx_gae_created
  ON governance_audit_events (tenant_id, created_at DESC);

-- RLS: each tenant sees only its own audit records
ALTER TABLE governance_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gae_tenant_policy ON governance_audit_events;
CREATE POLICY gae_tenant_policy ON governance_audit_events
  USING (tenant_id::text = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

COMMENT ON TABLE governance_audit_events IS
  'One record per sourcetype per snapshot: the complete scoring decision audit trail.';
