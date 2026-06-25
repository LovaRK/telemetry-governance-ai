-- ─────────────────────────────────────────────────────────────────
-- Migration 206: Snapshot certification (P4)
-- Validates every snapshot before it becomes the active pointer.
-- Prevents bad CSV → published snapshot → wrong recommendations.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshot_certifications (
  certification_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL,
  snapshot_id       UUID        NOT NULL,
  snapshot_source   VARCHAR(20) NOT NULL DEFAULT 'csv_analytics',
  validated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_by      TEXT        NOT NULL DEFAULT 'system',   -- 'system' | user_id
  rule_count        INT         NOT NULL DEFAULT 0,
  passed_checks     INT         NOT NULL DEFAULT 0,
  failed_checks     INT         NOT NULL DEFAULT 0,
  certified         BOOLEAN     NOT NULL DEFAULT FALSE,
  failure_reasons   JSONB,                                  -- null when certified=true
  metadata          JSONB
);

CREATE INDEX IF NOT EXISTS idx_cert_tenant_snapshot
  ON snapshot_certifications (tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_cert_tenant_certified
  ON snapshot_certifications (tenant_id, certified, validated_at DESC);

ALTER TABLE snapshot_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cert_tenant_policy ON snapshot_certifications;
CREATE POLICY cert_tenant_policy ON snapshot_certifications
  USING (tenant_id::text = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

COMMENT ON TABLE snapshot_certifications IS
  'One row per snapshot: validation result before the snapshot becomes active.';

-- ─────────────────────────────────────────────────────────────────
