-- ─────────────────────────────────────────────────────────────────
-- Migration 205a: Governance decision audit events table
-- (Backport — was missing from this directory; only existed in apps/api/migrations/205)
--
-- This table is the write target for core/governance/governance-audit-store.ts.
-- Migration 208 (snapshot_retention) adds archived_at to this table and creates
-- an index on (tenant_id, archived_at) — so this table MUST exist before 208 runs.
--
-- Column names use quoted camelCase to match the INSERT in governance-audit-store.ts
-- without requiring an ORM mapping layer.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_audit_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "decisionId"         UUID,
  decision             TEXT,
  "riskLevel"          TEXT,
  actor                TEXT,
  "actorId"            TEXT,
  "actorType"          TEXT,
  action               TEXT,
  resource             TEXT,
  environment          TEXT,
  "traceId"            TEXT,
  "correlationId"      TEXT,
  "causationId"        TEXT,
  "integrityState"     TEXT,
  "governanceMode"     TEXT,
  "policySnapshotHash" TEXT,
  "matchedPolicies"    TEXT,
  reasons              JSONB,
  "evaluationMs"       NUMERIC,
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata             JSONB,
  -- tenant_id is required by migration 208 which creates an index on (tenant_id, archived_at)
  tenant_id            UUID
);

-- Primary query pattern: by tenant, chronological
CREATE INDEX IF NOT EXISTS idx_gae_tenant_created
  ON governance_audit_events (tenant_id, "createdAt" DESC);

-- Query by decision outcome
CREATE INDEX IF NOT EXISTS idx_gae_decision
  ON governance_audit_events (tenant_id, decision, "createdAt" DESC);

COMMENT ON TABLE governance_audit_events IS
  'Immutable audit trail for every governance decision emitted by governance-audit-store.ts.';
