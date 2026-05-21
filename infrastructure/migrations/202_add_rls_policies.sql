-- Migration: Add Row-Level Security (RLS) policies
-- Purpose: Defense-in-depth tenant isolation at the database layer
--
-- Even if application code has bugs (missing tenant_id in WHERE clause),
-- the database enforces that queries can only access the current tenant.
--
-- All tables are protected. RLS short-circuits queries that would leak data.

-- =============================================================================
-- 1. Enable RLS on all tenant-scoped tables
-- =============================================================================

ALTER TABLE telemetry_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_snapshot_pointer ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_metadata ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. Create RLS policies (tenant isolation)
-- =============================================================================

-- Helper: Extract current tenant from session context
-- Queries must include: SET app.current_tenant = '<tenant_uuid>'
-- This is set by the application at request time via SQL session variable.

CREATE POLICY telemetry_snapshots_tenant_policy
ON telemetry_snapshots
USING (tenant_id::text = current_setting('app.current_tenant', true))
WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY agent_decisions_tenant_policy
ON agent_decisions
USING (tenant_id::text = current_setting('app.current_tenant', true))
WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY executive_kpis_tenant_policy
ON executive_kpis
USING (tenant_id::text = current_setting('app.current_tenant', true))
WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY pipeline_runs_tenant_policy
ON pipeline_runs
USING (tenant_id::text = current_setting('app.current_tenant', true))
WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY pipeline_stage_events_tenant_policy
ON pipeline_stage_events
USING (EXISTS (
  SELECT 1 FROM pipeline_runs
  WHERE pipeline_runs.run_id = pipeline_stage_events.run_id
  AND pipeline_runs.tenant_id::text = current_setting('app.current_tenant', true)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM pipeline_runs
  WHERE pipeline_runs.run_id = pipeline_stage_events.run_id
  AND pipeline_runs.tenant_id::text = current_setting('app.current_tenant', true)
));

CREATE POLICY tenant_snapshot_pointer_tenant_policy
ON tenant_snapshot_pointer
USING (tenant_id::text = current_setting('app.current_tenant', true))
WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY job_queue_tenant_policy
ON job_queue
USING (
  payload->>'tenantId' = current_setting('app.current_tenant', true)
)
WITH CHECK (
  payload->>'tenantId' = current_setting('app.current_tenant', true)
);

CREATE POLICY cache_metadata_tenant_policy
ON cache_metadata
USING (true);  -- Cache metadata is non-sensitive and shared

-- =============================================================================
-- 3. Integration pattern (APPLICATION SIDE)
-- =============================================================================
--
-- All database transactions that access tenant data MUST set the session:
--
--   const client = await getClient();
--   await client.query(`SET app.current_tenant = $1`, [ctx.tenantId]);
--   try {
--     // All queries now filtered by RLS
--     await client.query(`SELECT * FROM telemetry_snapshots WHERE ...`);
--   } finally {
--     client.release();
--   }
--
-- Without SET, current_setting('app.current_tenant') returns NULL,
-- and the RLS policies return zero rows (fail-closed).

-- =============================================================================
-- 4. Verification
-- =============================================================================
--
-- Test that RLS is active:
--
--   -- Without setting context: should return 0 rows
--   SELECT COUNT(*) FROM telemetry_snapshots;
--   -- Output: 0
--
--   -- With context: should return filtered results
--   SET app.current_tenant = '550e8400-e29b-41d4-a716-446655440000';
--   SELECT COUNT(*) FROM telemetry_snapshots;
--   -- Output: N (where N is the count for that tenant)
--
-- Note: Superusers bypass RLS unless FORCE ROW LEVEL SECURITY is used.
-- For audit accounts or migrations, use FORCE.
