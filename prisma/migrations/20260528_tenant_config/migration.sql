-- Tenant Configuration Table
-- Replaces in-memory runtime config (which is lost on server restart).
-- All runtime configuration is now persisted per-tenant with full audit trail.
--
-- CRITICAL: This eliminates the "in-memory only for demo" anti-pattern in config/route.ts
-- Config changes survive restarts, scale across multiple API instances, and are auditable.

CREATE TABLE IF NOT EXISTS "tenant_config" (
  "tenant_id"   TEXT        NOT NULL,
  "key"         TEXT        NOT NULL,
  "value"       JSONB       NOT NULL,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_by"  TEXT,
  PRIMARY KEY ("tenant_id", "key")
);

-- Index for fast per-tenant lookups
CREATE INDEX IF NOT EXISTS "tenant_config_tenant_idx"
  ON "tenant_config" ("tenant_id");

-- Seed default system configuration (idempotent)
-- These are the defaults that were previously hardcoded in runtime-config.ts
INSERT INTO "tenant_config" ("tenant_id", "key", "value", "updated_by")
VALUES
  ('SYSTEM', 'costPerGbPerDay',  '0.5',    'migration'),
  ('SYSTEM', 'maxIndexesPerRun', '1000',   'migration'),
  ('SYSTEM', 'llmTimeoutMs',     '30000',  'migration')
ON CONFLICT ("tenant_id", "key") DO NOTHING;
