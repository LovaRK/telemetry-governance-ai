-- ============================================
-- Migration 106: Sprint 1 Authentication & Multi-Tenancy
-- Date: 2026-05-18
-- Description: Add user authentication, sessions, and multi-tenant support
-- ============================================

-- ============================================
-- 1. TENANTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    slug                VARCHAR(50) NOT NULL UNIQUE,
    splunk_url          VARCHAR(1000),
    splunk_hec_token    VARCHAR(1000),  -- Will be encrypted at application level
    splunk_username     VARCHAR(255),   -- Optional for Splunk auth
    splunk_password     VARCHAR(1000),  -- Will be encrypted at application level
    splunk_ssl_verify   BOOLEAN DEFAULT true,
    tenant_status       VARCHAR(20) DEFAULT 'active' CHECK (tenant_status IN ('active', 'suspended', 'deleted')),
    is_configured       BOOLEAN DEFAULT false,  -- Flag for whether Splunk is fully configured
    last_splunk_test    TIMESTAMPTZ,
    splunk_test_status  VARCHAR(20) CHECK (splunk_test_status IN ('success', 'failed', 'not_tested')),
    splunk_test_error   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(tenant_status);

-- ============================================
-- 2. USERS TABLE (with tenant_id)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email               VARCHAR(255) NOT NULL,
    name                VARCHAR(255),
    password_hash       VARCHAR(255),  -- NULL if using OAuth
    role                VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
    auth_provider       VARCHAR(50) DEFAULT 'local' CHECK (auth_provider IN ('local', 'oauth', 'saml')),
    last_login          TIMESTAMPTZ,
    login_attempts      INTEGER DEFAULT 0,
    is_locked           BOOLEAN DEFAULT false,
    locked_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================
-- 3. USER SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token               VARCHAR(500) NOT NULL UNIQUE,
    ip_address          INET,
    user_agent          TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_revoked          BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON user_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions(expires_at);

-- ============================================
-- 4. TENANT CONFIGURATION (for multi-tenant settings)
-- ============================================
CREATE TABLE IF NOT EXISTS tenant_config (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    cost_per_gb_per_day DECIMAL(8,2) NOT NULL DEFAULT 0.50,
    max_retention_days  INTEGER NOT NULL DEFAULT 730,
    max_parallel        INTEGER NOT NULL DEFAULT 2,
    decision_weights    JSONB NOT NULL DEFAULT '{}',
    retention_policy    JSONB NOT NULL DEFAULT '{"CRITICAL": 730, "IMPORTANT": 365, "NICE_TO_HAVE": 90, "LOW_VALUE": 30}',
    notification_config JSONB NOT NULL DEFAULT '{"email": true, "in_app": true, "webhook": false}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_config_tenant_id ON tenant_config(tenant_id);

-- ============================================
-- 5. AUDIT LOG FOR MULTI-TENANT OPERATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS tenant_audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    action              VARCHAR(100) NOT NULL,
    resource_type       VARCHAR(50),
    resource_id         VARCHAR(255),
    changes             JSONB,
    ip_address          INET,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON tenant_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON tenant_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON tenant_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON tenant_audit_log(created_at);

-- ============================================
-- 6. ADD tenant_id TO EXISTING TABLES
-- ============================================

-- Add tenant_id to executive_kpis
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_exec_kpis_tenant ON executive_kpis(tenant_id);

-- Add tenant_id to agent_decisions
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_agent_decisions_tenant ON agent_decisions(tenant_id);

-- Add tenant_id to user_config
ALTER TABLE user_config ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'unique_tenant_config' AND table_name = 'user_config') THEN
    ALTER TABLE user_config ADD CONSTRAINT unique_tenant_config UNIQUE (tenant_id, config_key);
  END IF;
END $$;

-- Add tenant_id to search_audit
ALTER TABLE search_audit ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_search_audit_tenant ON search_audit(tenant_id);

-- Add tenant_id to data_quality_summary (only if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'data_quality_summary') THEN
    ALTER TABLE data_quality_summary ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_quality_summary_tenant ON data_quality_summary(tenant_id);
  END IF;
END $$;

-- ============================================
-- 7. TRIGGERS FOR UPDATED_AT
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_name = 'update_tenants_updated_at' AND event_object_table = 'tenants') THEN
    CREATE TRIGGER update_tenants_updated_at
        BEFORE UPDATE ON tenants
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_name = 'update_users_updated_at' AND event_object_table = 'users') THEN
    CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_name = 'update_tenant_config_updated_at' AND event_object_table = 'tenant_config') THEN
    CREATE TRIGGER update_tenant_config_updated_at
        BEFORE UPDATE ON tenant_config
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================
-- 8. HELPER FUNCTIONS
-- ============================================

-- Function to get or create tenant
CREATE OR REPLACE FUNCTION get_or_create_tenant(p_name VARCHAR, p_slug VARCHAR)
RETURNS UUID AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Try to get existing tenant
    SELECT id INTO v_tenant_id FROM tenants WHERE slug = p_slug;

    IF v_tenant_id IS NULL THEN
        -- Create new tenant
        INSERT INTO tenants (name, slug) VALUES (p_name, p_slug)
        RETURNING id INTO v_tenant_id;
    END IF;

    RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql;

-- Function to verify session is valid and not expired
CREATE OR REPLACE FUNCTION verify_session(p_token VARCHAR)
RETURNS TABLE(
    session_id UUID,
    user_id UUID,
    tenant_id UUID,
    email VARCHAR,
    role VARCHAR,
    is_valid BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        us.id,
        u.id,
        u.tenant_id,
        u.email,
        u.role,
        (us.expires_at > NOW() AND NOT us.is_revoked AND NOT u.is_locked)::BOOLEAN
    FROM user_sessions us
    JOIN users u ON us.user_id = u.id
    WHERE us.token = p_token;
END;
$$ LANGUAGE plpgsql;

-- Function to create audit log entry
CREATE OR REPLACE FUNCTION log_tenant_action(
    p_tenant_id UUID,
    p_user_id UUID,
    p_action VARCHAR,
    p_resource_type VARCHAR DEFAULT NULL,
    p_resource_id VARCHAR DEFAULT NULL,
    p_changes JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO tenant_audit_log (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (p_tenant_id, p_user_id, p_action, p_resource_type, p_resource_id, p_changes, p_ip_address)
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. REFRESH TOKENS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_tenant ON refresh_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE NOT is_revoked;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked ON refresh_tokens(is_revoked) WHERE is_revoked = true;
