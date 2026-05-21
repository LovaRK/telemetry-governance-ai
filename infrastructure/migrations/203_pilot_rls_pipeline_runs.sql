-- Migration 203: Pilot RLS on pipeline_runs
-- Purpose: Test RLS enforcement on one table before expanding to all tables
--
-- This is a single-table pilot to verify:
-- 1. RLS policies work correctly
-- 2. Application sets session context properly
-- 3. Queries still return correct results with context
-- 4. Queries return 0 rows without context (fail-closed)
--
-- Once validated, expand to remaining tables (migration 202)

-- =============================================================================
-- Enable RLS on pipeline_runs only
-- =============================================================================

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Create RLS policy for pipeline_runs
-- =============================================================================

CREATE POLICY pipeline_runs_tenant_policy
ON pipeline_runs
USING (tenant_id::text = current_setting('app.current_tenant', true))
WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

-- =============================================================================
-- Verification queries (run after deployment)
-- =============================================================================

-- Test 1: Without setting context — should return 0 rows (fail-closed)
-- SELECT COUNT(*) FROM pipeline_runs;
-- Expected: 0

-- Test 2: With context set — should return tenant-scoped rows
-- SET app.current_tenant = '550e8400-e29b-41d4-a716-446655440000';
-- SELECT COUNT(*) FROM pipeline_runs;
-- Expected: N (where N = number of runs for that tenant)

-- Test 3: Cross-tenant verification — tenant A cannot see tenant B
-- SET app.current_tenant = 'tenant-a-uuid';
-- SELECT COUNT(*) FROM pipeline_runs;  -- Expected: A's row count
--
-- SET app.current_tenant = 'tenant-b-uuid';
-- SELECT COUNT(*) FROM pipeline_runs;  -- Expected: B's row count (different)
--
-- SET app.current_tenant = 'tenant-a-uuid';
-- SELECT COUNT(*) FROM pipeline_runs;  -- Expected: A's row count again

-- Test 4: Permission denied without context
-- RESET app.current_tenant;
-- SELECT COUNT(*) FROM pipeline_runs;
-- Expected: 0 rows (not error, just no data)
