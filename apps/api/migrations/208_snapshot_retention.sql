
-- ─────────────────────────────────────────────────────────────────
-- Migration 208: Snapshot retention indexes + archive flag (P2)
-- Adds archived_at to key tables. Adds missing performance indexes.
-- ─────────────────────────────────────────────────────────────────

-- Archive flag: soft-delete old snapshots, retain lineage
ALTER TABLE telemetry_snapshots     ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE governance_audit_events ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE executive_kpis          ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Missing indexes called out in review
CREATE INDEX IF NOT EXISTS idx_ts_tenant_snapshot_source
  ON telemetry_snapshots (tenant_id, snapshot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gae_archived
  ON governance_audit_events (tenant_id, archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ek_tenant_published
  ON executive_kpis (tenant_id, snapshot_date DESC);

-- Snapshot retention policy config table
-- Stores per-tenant retention rules (avoids hard-coding in application layer).
CREATE TABLE IF NOT EXISTS snapshot_retention_policy (
  policy_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL UNIQUE,
  max_live_snapshots  INT         NOT NULL DEFAULT 12,
  archive_after_days  INT         NOT NULL DEFAULT 90,
  delete_after_days   INT,                            -- null = never delete
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default policy for the production tenant
INSERT INTO snapshot_retention_policy
  (tenant_id, max_live_snapshots, archive_after_days, delete_after_days)
VALUES
  ('a11d19eb-6be3-4f9a-9a78-7c8c5182810e', 12, 90, NULL)
ON CONFLICT (tenant_id) DO NOTHING;

COMMENT ON TABLE snapshot_retention_policy IS
  'Per-tenant snapshot retention rules. max_live_snapshots=12 keeps rolling year of weekly snapshots.';

