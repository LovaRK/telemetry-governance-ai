-- ─────────────────────────────────────────────────────────────────
-- Migration 204a: Separate snapshot pointer by source
-- (Backport from apps/api/migrations/204 — was missing from this directory)
--
-- Prevents CSV analytics snapshot from being overwritten by Splunk live refresh.
--
-- Before: ONE row per tenant → any pipeline overwrites it
-- After:  TWO rows per tenant (one per source) → each pipeline owns its own pointer
--
-- snapshot_source values:
--   'splunk_live'    → owned by Splunk Refresh pipeline
--   'csv_analytics'  → owned by 1stmile CSV pipeline
-- ─────────────────────────────────────────────────────────────────

-- Step 1: Add source column with default so existing row is preserved
ALTER TABLE tenant_snapshot_pointer
  ADD COLUMN IF NOT EXISTS snapshot_source VARCHAR(20) NOT NULL DEFAULT 'splunk_live';

-- Step 2: Drop the single-tenant primary key, replace with composite
--         (IF NOT EXISTS guard: safe to run on a fresh DB or after manual fix)
ALTER TABLE tenant_snapshot_pointer DROP CONSTRAINT IF EXISTS tenant_snapshot_pointer_pkey;
ALTER TABLE tenant_snapshot_pointer
  ADD CONSTRAINT tenant_snapshot_pointer_pkey
  PRIMARY KEY (tenant_id, snapshot_source);

COMMENT ON COLUMN tenant_snapshot_pointer.snapshot_source IS
  'Pipeline that owns this pointer: splunk_live or csv_analytics';
