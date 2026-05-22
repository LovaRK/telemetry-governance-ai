-- Phase P7.1: Incremental aggregation watermark ledger (schema only)
-- Non-breaking foundation; no behavior changes in this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS aggregation_watermarks (
  watermark_id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  last_processed_ts TIMESTAMPTZ,
  snapshot_id VARCHAR(128),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_aggregation_watermarks_tenant_source UNIQUE (tenant_id, source_type)
);

CREATE INDEX IF NOT EXISTS idx_aggregation_watermarks_tenant
  ON aggregation_watermarks(tenant_id);

CREATE INDEX IF NOT EXISTS idx_aggregation_watermarks_updated_at
  ON aggregation_watermarks(updated_at DESC);

COMMIT;
