-- Phase 11: Data Quality SLOs + Governance Operational Metrics
-- Additive-only migration — no existing tables altered.

-- ─────────────────────────────────────────────────────────────────────────────
-- DATA QUALITY SLOs
-- Defines the thresholds and enforcement modes for each pipeline quality signal.
-- Enforcement: WARN (log only) | ALERT (emit OTel event) | BLOCK (reject pipeline run)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_quality_slos (
  id                   TEXT        PRIMARY KEY,
  metric_name          TEXT        NOT NULL UNIQUE,
  description          TEXT,
  expected_min         REAL,                        -- null = no lower bound
  expected_max         REAL,                        -- null = no upper bound
  violation_threshold  REAL        NOT NULL,
  enforcement_mode     TEXT        NOT NULL DEFAULT 'WARN'
                         CHECK (enforcement_mode IN ('WARN', 'ALERT', 'BLOCK')),
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Built-in SLOs (idempotent insert)
INSERT INTO data_quality_slos
  (id, metric_name, description, expected_min, expected_max, violation_threshold, enforcement_mode)
VALUES
  ('slo-snapshot-freshness',
   'snapshot_freshness_hours',
   'Max age of most recent gold snapshot',
   NULL, NULL, 48, 'ALERT'),

  ('slo-parser-confidence',
   'parser_confidence_pct',
   'Min parser confidence score (0–100)',
   70, NULL, 50, 'WARN'),

  ('slo-duplicate-events',
   'duplicate_event_pct',
   'Max duplicate event percentage in bronze layer',
   NULL, NULL, 5, 'WARN'),

  ('slo-unresolved-spl',
   'unresolved_spl_pct',
   'Max unresolved SPL fields percentage per audit run',
   NULL, NULL, 20, 'WARN'),

  ('slo-ingestion-completeness',
   'ingestion_completeness_pct',
   'Min ingestion completeness (% indexes with recent events)',
   95, NULL, 80, 'ALERT'),

  ('slo-scoring-drift',
   'scoring_drift_pct',
   'Max acceptable composite score drift between consecutive gold snapshots',
   NULL, NULL, 15, 'ALERT'),

  ('slo-pipeline-latency',
   'pipeline_latency_minutes',
   'Max acceptable Bronze→Gold pipeline latency',
   NULL, NULL, 30, 'WARN'),

  ('slo-audit-write-failure',
   'audit_write_failure_rate_pct',
   'Max governance audit write failure rate (rolling 5m)',
   NULL, NULL, 1, 'ALERT')

ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- GOVERNANCE OPERATIONAL METRICS
-- Time-series store for platform self-observability.
-- Tagged component=platform; never stores customer telemetry data.
-- Retention policy: prune rows older than 30 days (handled by maintenance job).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_operational_metrics (
  id           TEXT        PRIMARY KEY,
  metric_name  TEXT        NOT NULL,
  value        REAL        NOT NULL,
  unit         TEXT        NOT NULL
                 CHECK (unit IN ('ms', 'count', 'percent', 'hours', 'gb', 'rows_per_sec')),
  tenant_id    TEXT,                       -- null = platform-wide metric
  environment  TEXT        NOT NULL DEFAULT 'sandbox',
  metric_window TEXT,                       -- '5m' | '1h' | '24h' | null (point-in-time)
  tags         JSONB       NOT NULL DEFAULT '{}',
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gov_op_metrics_name_time_idx
  ON governance_operational_metrics (metric_name, recorded_at DESC);

CREATE INDEX IF NOT EXISTS gov_op_metrics_tenant_idx
  ON governance_operational_metrics (tenant_id, recorded_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gov_op_metrics_env_idx
  ON governance_operational_metrics (environment, recorded_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- DATA QUALITY VIOLATION LOG
-- Records each SLO violation event with context.
-- Used by the metrics API for trend queries and OTel export.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_quality_violation_log (
  id                TEXT        PRIMARY KEY,
  slo_id            TEXT        NOT NULL REFERENCES data_quality_slos(id),
  tenant_id         TEXT,
  metric_name       TEXT        NOT NULL,
  observed_value    REAL        NOT NULL,
  threshold_value   REAL        NOT NULL,
  enforcement_mode  TEXT        NOT NULL,
  context           JSONB       NOT NULL DEFAULT '{}',  -- pipeline_run_id, index_name, etc.
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dq_violation_slo_idx
  ON data_quality_violation_log (slo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dq_violation_tenant_idx
  ON data_quality_violation_log (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dq_violation_unresolved_idx
  ON data_quality_violation_log (metric_name, created_at DESC)
  WHERE resolved_at IS NULL;
