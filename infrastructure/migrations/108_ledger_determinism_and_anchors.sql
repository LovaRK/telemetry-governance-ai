-- ====================================================================
-- MIGRATION 108: LEDGER DETERMINISM & CRYPTOGRAPHIC ROOT ANCHORS
-- PURPOSE: Correct structural gaps in binding hash chain integrity
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Add monotonic position sequence independent of clock drift
-- GENERATED ALWAYS AS IDENTITY ensures strict ordering even under concurrent writes
ALTER TABLE operator_trace_bindings
    ADD COLUMN chain_position BIGINT GENERATED ALWAYS AS IDENTITY,
    ADD COLUMN root_chain_hash VARCHAR(64),
    ADD COLUMN hash_algorithm_version VARCHAR(32) NOT NULL DEFAULT 'SHA256_JCS_V1';

-- 2. Enforce absolute deterministic sequence ordering per distributed trace context
-- This index prevents concurrent writes from creating ordering ambiguities
CREATE UNIQUE INDEX idx_trace_chain_position
    ON operator_trace_bindings (trace_id, chain_position);

-- 3. Ensure binding hashes themselves are globally unique (prevents collision attacks)
CREATE UNIQUE INDEX idx_binding_hash_unique
    ON operator_trace_bindings (binding_hash);

-- 4. Optimize tenant-scoped ledger retrieval by chain position (not timestamps)
DROP INDEX IF EXISTS idx_tenant_latest_binding;
CREATE INDEX idx_tenant_latest_binding_v2
    ON operator_trace_bindings (tenant_id, chain_position DESC, signature_hash);

-- 5. Fast lookup for chain verification during audit queries
CREATE INDEX idx_binding_chain_verification
    ON operator_trace_bindings (trace_id, chain_position ASC);

-- 6. Audit token family reuse detection for refresh token rotation security
ALTER TABLE refresh_tokens
    ADD COLUMN family_id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN reuse_detected BOOLEAN DEFAULT FALSE NOT NULL,
    ADD COLUMN rotation_count INT DEFAULT 0 NOT NULL,
    ADD COLUMN family_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 7. Index for scanning token lineages during rotation evaluations
CREATE INDEX idx_token_family_lookup
    ON refresh_tokens (family_id, is_revoked, reuse_detected);

-- 8. Index for reuse attack detection (find all tokens in a family)
CREATE INDEX idx_token_family_members
    ON refresh_tokens (family_id, created_at DESC);

-- 9. Index for session max lifetime enforcement
CREATE INDEX idx_token_family_created
    ON refresh_tokens (family_id, family_created_at);

-- ===== HELPER FUNCTIONS =====

-- Function to revoke entire refresh token family (for reuse attack response)
CREATE OR REPLACE FUNCTION revoke_token_family(p_family_id UUID, p_reason VARCHAR DEFAULT NULL)
RETURNS TABLE (revoked_count int) AS $$
DECLARE
  count int;
BEGIN
  UPDATE refresh_tokens
  SET is_revoked = true, reuse_detected = true
  WHERE family_id = p_family_id AND is_revoked = false;

  GET DIAGNOSTICS count = ROW_COUNT;

  -- Log the revocation event
  INSERT INTO refresh_token_audit_log (user_id, tenant_id, action, refresh_token_id, reason)
  SELECT DISTINCT user_id, tenant_id, 'FAMILY_REVOKED_REUSE_DETECTED', NULL, p_reason
  FROM refresh_tokens
  WHERE family_id = p_family_id
  LIMIT 1;

  RETURN QUERY SELECT count;
END;
$$ LANGUAGE plpgsql;

-- Function to check if a token family is compromised
CREATE OR REPLACE FUNCTION is_token_family_compromised(p_family_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM refresh_tokens
    WHERE family_id = p_family_id AND (is_revoked = true OR reuse_detected = true)
  );
END;
$$ LANGUAGE plpgsql;

COMMIT;
