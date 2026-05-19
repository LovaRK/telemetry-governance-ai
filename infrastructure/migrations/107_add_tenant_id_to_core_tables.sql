-- Migration 107: Add tenant_id to core data tables for multi-tenant isolation
-- Adds tenant_id column to telemetry_snapshots, agent_decisions, executive_kpis, job_queue
-- Defaults to the system tenant so existing rows remain queryable

BEGIN;

-- Default tenant UUID (matches seeded system tenant from migration 106)
DO $$
DECLARE
  default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

  -- telemetry_snapshots
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'telemetry_snapshots' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE telemetry_snapshots
      ADD COLUMN tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
    CREATE INDEX idx_telemetry_snapshots_tenant ON telemetry_snapshots(tenant_id);
  END IF;

  -- agent_decisions
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_decisions' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE agent_decisions
      ADD COLUMN tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
    CREATE INDEX idx_agent_decisions_tenant ON agent_decisions(tenant_id);
  END IF;

  -- executive_kpis
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'executive_kpis' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE executive_kpis
      ADD COLUMN tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
    CREATE INDEX idx_executive_kpis_tenant ON executive_kpis(tenant_id);
  END IF;

  -- job_queue
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_queue' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE job_queue
      ADD COLUMN tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
    CREATE INDEX idx_job_queue_tenant ON job_queue(tenant_id);
  END IF;

END $$;

COMMIT;
