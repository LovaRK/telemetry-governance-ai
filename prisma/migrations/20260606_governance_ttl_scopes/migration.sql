-- Phase 12: TTL + Revocation + Scopes + Tenant Isolation Enforcement
-- Additive-only migration — no existing tables altered.

-- ─────────────────────────────────────────────────────────────────────────────
-- GOVERNANCE PERMISSIONS WITH TTL
-- Time-bounded grants that auto-expire. Never retroactively deleted —
-- the expired_at column is consulted at eval time.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_permissions_ttl (
  id             TEXT        PRIMARY KEY,
  tenant_id      TEXT        NOT NULL,
  actor_id       TEXT        NOT NULL,
  resource_type  TEXT        NOT NULL,
  resource_id    TEXT        NOT NULL,
  permission     TEXT        NOT NULL,
  scope_id       TEXT,                    -- optional scope constraint
  granted_by     TEXT        NOT NULL,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,             -- set on revocation (before expiry)
  revoked_by     TEXT,
  revocation_id  TEXT,                    -- FK to governance_revocations.id
  last_used_at   TIMESTAMPTZ,
  use_count      INTEGER     NOT NULL DEFAULT 0,
  metadata       JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS gov_perm_ttl_tenant_idx
  ON governance_permissions_ttl (tenant_id, actor_id);

-- Note: expires_at > NOW() cannot be used in a partial index (NOW() is STABLE, not IMMUTABLE).
-- TTL expiry is enforced at query time. This index covers the common non-revoked lookup path.
CREATE INDEX IF NOT EXISTS gov_perm_ttl_active_idx
  ON governance_permissions_ttl (tenant_id, resource_type, permission)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS gov_perm_ttl_expiry_idx
  ON governance_permissions_ttl (expires_at)
  WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- GOVERNANCE REVOCATIONS
-- Immutable record of every revocation event. Once inserted, never deleted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_revocations (
  id              TEXT        PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  permission_id   TEXT        NOT NULL REFERENCES governance_permissions_ttl(id),
  revoked_by      TEXT        NOT NULL,
  reason          TEXT        NOT NULL,
  effective_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audit_event_id  TEXT,                  -- FK to governance_audit_events.id
  metadata        JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS gov_revoc_tenant_idx
  ON governance_revocations (tenant_id, effective_at DESC);

CREATE INDEX IF NOT EXISTS gov_revoc_permission_idx
  ON governance_revocations (permission_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- GOVERNANCE SCOPES
-- Named scope definitions that restrict where a permission applies.
-- Scopes bind: tenant + resource_type + optional index pattern.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_scopes (
  id              TEXT        PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  scope_name      TEXT        NOT NULL,
  description     TEXT,
  resource_type   TEXT        NOT NULL,   -- 'index' | 'sourcetype' | 'pipeline' | 'policy' | '*'
  resource_pattern TEXT       NOT NULL DEFAULT '*',  -- glob pattern; '*' = all
  environment     TEXT        NOT NULL DEFAULT 'both',  -- 'production' | 'sandbox' | 'both'
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_by      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, scope_name)
);

CREATE INDEX IF NOT EXISTS gov_scopes_tenant_idx
  ON governance_scopes (tenant_id, resource_type);

-- Seed built-in system scopes
INSERT INTO governance_scopes
  (id, tenant_id, scope_name, description, resource_type, resource_pattern, environment, created_by)
VALUES
  ('scope-sys-all-indexes',   'SYSTEM', 'all_indexes',   'All indexes across all tenants',    'index',     '*',            'both', 'system'),
  ('scope-sys-all-pipelines', 'SYSTEM', 'all_pipelines', 'All pipeline operations',           'pipeline',  '*',            'both', 'system'),
  ('scope-sys-all-policies',  'SYSTEM', 'all_policies',  'All governance policy operations',  'policy',    '*',            'both', 'system'),
  ('scope-sys-sandbox-only',  'SYSTEM', 'sandbox_only',  'Sandbox environment only',          '*',         '*',            'sandbox', 'system')
ON CONFLICT (tenant_id, scope_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- TTL CLEANUP LOG
-- Tracks automated TTL expiry sweeps. Governance TTL engine writes here
-- so operators can verify the sweep is running.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_ttl_sweep_log (
  id             TEXT        PRIMARY KEY,
  swept_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expired_count  INTEGER     NOT NULL DEFAULT 0,
  checked_count  INTEGER     NOT NULL DEFAULT 0,
  duration_ms    INTEGER     NOT NULL DEFAULT 0,
  environment    TEXT        NOT NULL DEFAULT 'sandbox'
);

CREATE INDEX IF NOT EXISTS gov_ttl_sweep_idx
  ON governance_ttl_sweep_log (swept_at DESC);
