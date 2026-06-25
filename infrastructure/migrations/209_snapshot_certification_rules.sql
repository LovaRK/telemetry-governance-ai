-- Migration 209: Per-rule certification audit
--
-- snapshot_certifications stores the summary (pass/fail totals).
-- This table stores one row per rule per snapshot:
--   Which rule? Did it pass? What values triggered a failure?
--
-- Use case: when a certification fails six months from now, answer:
--   "Which rule failed, and what were the actual values at the time?"
-- without re-running ingestion.
--
-- Inserted atomically inside the same transaction as snapshot_certifications.

CREATE TABLE IF NOT EXISTS snapshot_certification_rules (
  rule_run_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id  UUID        NOT NULL REFERENCES snapshot_certifications(certification_id) ON DELETE CASCADE,
  tenant_id         UUID        NOT NULL,
  snapshot_id       UUID        NOT NULL,
  rule_name         VARCHAR(20) NOT NULL,   -- R1 … R8
  rule_description  TEXT        NOT NULL,
  passed            BOOLEAN     NOT NULL,
  details           TEXT,                   -- null on pass; describes failure values on fail
  executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scr_certification
  ON snapshot_certification_rules (certification_id);
CREATE INDEX IF NOT EXISTS idx_scr_tenant_snapshot
  ON snapshot_certification_rules (tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_scr_failed
  ON snapshot_certification_rules (tenant_id, passed, executed_at DESC)
  WHERE passed = false;

ALTER TABLE snapshot_certification_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scr_tenant_policy ON snapshot_certification_rules;
CREATE POLICY scr_tenant_policy ON snapshot_certification_rules
  USING (tenant_id::text = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

COMMENT ON TABLE snapshot_certification_rules IS
  'One row per rule per certification run. Enables post-hoc diagnosis of why a snapshot failed.';
