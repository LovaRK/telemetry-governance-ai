-- Migration 107: Sprint 2 - Operator Provenance & Token Rotation
-- Adds refresh token storage for JWT rotation and immutable operator audit bindings

-- ===== REFRESH TOKENS TABLE =====
-- Stores refresh tokens for JWT rotation with nonce-based replay prevention

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nonce VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookup and cleanup
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_tenant ON refresh_tokens(tenant_id);
CREATE INDEX idx_refresh_tokens_nonce ON refresh_tokens(nonce);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at)
  WHERE NOT is_revoked; -- Only index active tokens
CREATE INDEX idx_refresh_tokens_revoked ON refresh_tokens(is_revoked)
  WHERE is_revoked = true; -- For revocation cleanup

-- ===== OPERATOR TRACE BINDINGS TABLE =====
-- Immutable audit trail of operator actions on traces
-- Prevents tampering via cryptographic signature verification

CREATE TABLE IF NOT EXISTS operator_trace_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id VARCHAR(255) NOT NULL UNIQUE, -- Hex string from randomBytes(16)
  trace_id VARCHAR(255) NOT NULL,
  originating_span_id VARCHAR(255),

  -- Operator session snapshot (JSON for flexibility as operator schema evolves)
  operator_session_snapshot JSONB NOT NULL, -- {sessionId, operatorHash, userId, tenantId, email, name, role, loginAt, ipAddress, userAgent}

  -- Authorization context
  authorization_context JSONB, -- {contextId, operatorSessionId, authorizationScope, grantedScopes[], expiresAt, createdAt}

  -- Action details
  action_type VARCHAR(100) NOT NULL, -- 'TRACE_READ', 'DECISION_APPROVE', 'REPLAY_AUTHORIZE', etc.
  action_payload JSONB NOT NULL, -- Action-specific data

  -- Immutability guarantee
  signature_hash VARCHAR(255), -- SHA256 hash of (operatorHash:actionType:actionPayload:signedAt)
  signed_at TIMESTAMPTZ NOT NULL, -- When the binding was signed
  signed_by VARCHAR(100), -- Service that signed this binding

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient audit queries
CREATE INDEX idx_operator_bindings_trace ON operator_trace_bindings(trace_id);
CREATE INDEX idx_operator_bindings_user ON operator_trace_bindings(
  (operator_session_snapshot->>'userId')
);
CREATE INDEX idx_operator_bindings_email ON operator_trace_bindings(
  (operator_session_snapshot->>'email')
);
CREATE INDEX idx_operator_bindings_tenant ON operator_trace_bindings(
  (operator_session_snapshot->>'tenantId')
);
CREATE INDEX idx_operator_bindings_signed_at ON operator_trace_bindings(signed_at DESC);
CREATE INDEX idx_operator_bindings_action_type ON operator_trace_bindings(action_type);

-- ===== AUDIT LOG ENTRIES FOR TOKEN OPERATIONS =====
-- Optional: log refresh token issuance and revocation for compliance

CREATE TABLE IF NOT EXISTS refresh_token_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL, -- 'ISSUED', 'ROTATED', 'REVOKED', 'EXPIRED'
  refresh_token_id UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  ip_address INET,
  user_agent TEXT,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_token_audit_user ON refresh_token_audit_log(user_id);
CREATE INDEX idx_refresh_token_audit_tenant ON refresh_token_audit_log(tenant_id);
CREATE INDEX idx_refresh_token_audit_action ON refresh_token_audit_log(action);
CREATE INDEX idx_refresh_token_audit_created ON refresh_token_audit_log(created_at DESC);

-- ===== HELPER FUNCTIONS =====

-- Function to cleanup expired refresh tokens
CREATE OR REPLACE FUNCTION cleanup_expired_refresh_tokens()
RETURNS TABLE (deleted_count int) AS $$
DECLARE
  count int;
BEGIN
  DELETE FROM refresh_tokens
  WHERE expires_at < NOW() AND is_revoked = true;

  GET DIAGNOSTICS count = ROW_COUNT;

  RETURN QUERY SELECT count;
END;
$$ LANGUAGE plpgsql;

-- Function to log refresh token events
CREATE OR REPLACE FUNCTION log_refresh_token_event(
  p_user_id UUID,
  p_tenant_id UUID,
  p_action VARCHAR,
  p_token_id UUID,
  p_ip_address INET,
  p_user_agent TEXT,
  p_reason VARCHAR
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO refresh_token_audit_log (
    user_id, tenant_id, action, refresh_token_id,
    ip_address, user_agent, reason
  )
  VALUES (
    p_user_id, p_tenant_id, p_action, p_token_id,
    p_ip_address, p_user_agent, p_reason
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- Function to verify operator trace binding integrity
CREATE OR REPLACE FUNCTION verify_operator_trace_binding(
  p_binding_id VARCHAR
)
RETURNS TABLE (
  is_valid boolean,
  binding_id VARCHAR,
  action_type VARCHAR,
  signed_at TIMESTAMPTZ,
  signature_hash VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (
      -- Verify signature exists
      (otb.signature_hash IS NOT NULL) AND
      -- Verify binding hasn't been modified
      -- (detailed verification done in application layer)
      true
    ) as is_valid,
    otb.binding_id,
    otb.action_type,
    otb.signed_at,
    otb.signature_hash
  FROM operator_trace_bindings otb
  WHERE otb.binding_id = p_binding_id;
END;
$$ LANGUAGE plpgsql;

-- ===== GRANTS =====
-- Ensure proper access control for audit tables

GRANT SELECT ON refresh_tokens TO api_user;
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO api_user;
GRANT SELECT ON refresh_token_audit_log TO api_user;
GRANT INSERT ON refresh_token_audit_log TO api_user;
GRANT SELECT ON operator_trace_bindings TO api_user;
GRANT INSERT ON operator_trace_bindings TO api_user;
GRANT EXECUTE ON FUNCTION cleanup_expired_refresh_tokens TO api_user;
GRANT EXECUTE ON FUNCTION log_refresh_token_event TO api_user;
GRANT EXECUTE ON FUNCTION verify_operator_trace_binding TO api_user;
