-- Migration 204: Separate snapshot pointer by source
-- Prevents CSV analytics snapshot from being overwritten by Splunk live refresh.
--
-- Before: ONE row per tenant → any pipeline overwrites it
-- After:  TWO rows per tenant (one per source) → each pipeline owns its own pointer
--
-- snapshot_source values:
--   'splunk_live'    → owned by Splunk Refresh pipeline (event counts, live telemetry)
--   'csv_analytics'  → owned by 1stmile CSV pipeline (scored sourcetypes, ROI, tiers)
--
-- executive-summary reads csv_analytics first, falls back to splunk_live.
-- cache-status reads splunk_live for live ingest metrics.

-- Step 1: Add source column with default so existing row is preserved
ALTER TABLE tenant_snapshot_pointer
  ADD COLUMN IF NOT EXISTS snapshot_source VARCHAR(20) NOT NULL DEFAULT 'splunk_live';

-- Step 2: Drop the single-tenant primary key, replace with composite
ALTER TABLE tenant_snapshot_pointer DROP CONSTRAINT IF EXISTS tenant_snapshot_pointer_pkey;
ALTER TABLE tenant_snapshot_pointer
  ADD CONSTRAINT tenant_snapshot_pointer_pkey
  PRIMARY KEY (tenant_id, snapshot_source);

-- Step 3: Existing row is now (tenant_id, 'splunk_live') — correct, no data migration needed

-- Step 4: Update RLS policy to include snapshot_source in check
-- (policy already uses tenant_id which is sufficient; no change needed)

COMMENT ON COLUMN tenant_snapshot_pointer.snapshot_source IS
  'Pipeline that owns this pointer: splunk_live or csv_analytics';
