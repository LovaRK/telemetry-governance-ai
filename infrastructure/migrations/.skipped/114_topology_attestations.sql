-- ====================================================================
-- MIGRATION 114: SIGNED TOPOLOGY ATTESTATIONS
-- PURPOSE: Store and verify signed attestations of deployment topology
-- CONTEXT: BEFORE SSE - Prevents topology spoofing attacks
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Create table for topology attestations (deployment state snapshots with signatures)
CREATE TABLE topology_attestations (
  attestation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Deployment state
  epoch INT NOT NULL, -- Deployment epoch number
  deployment_id VARCHAR(255) NOT NULL, -- Unique deployment identifier
  signer_id VARCHAR(255) NOT NULL, -- Who signed this attestation (operator, CI/CD system)

  -- Cryptographic integrity
  signature VARCHAR(512) NOT NULL, -- Hex-encoded HMAC or RSA signature
  manifest_json JSONB NOT NULL, -- Complete service manifest (services, versions, health)

  -- Lifecycle tracking
  signed_at TIMESTAMPTZ NOT NULL, -- When attestation was created
  expires_at TIMESTAMPTZ NOT NULL, -- When attestation becomes invalid
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Index for fast lookup of latest attestations
CREATE INDEX idx_attestation_latest
  ON topology_attestations (tenant_id, epoch DESC, created_at DESC)
  WHERE expires_at > NOW();

-- 3. Index for finding attestations by deployment
CREATE INDEX idx_attestation_deployment
  ON topology_attestations (tenant_id, deployment_id, expires_at DESC);

-- 4. Index for expiration cleanup
CREATE INDEX idx_attestation_expiration
  ON topology_attestations (expires_at)
  WHERE expires_at < NOW();

-- 5. Helper function to get latest valid attestation
CREATE OR REPLACE FUNCTION get_latest_topology_attestation(p_tenant_id UUID)
RETURNS TABLE (
  epoch INT,
  deployment_id VARCHAR,
  signer_id VARCHAR,
  signature VARCHAR,
  manifest JSONB,
  signed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ta.epoch,
    ta.deployment_id,
    ta.signer_id,
    ta.signature,
    ta.manifest_json,
    ta.signed_at,
    ta.expires_at
  FROM topology_attestations ta
  WHERE ta.tenant_id = p_tenant_id
    AND ta.expires_at > NOW()
  ORDER BY ta.epoch DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. Helper function to verify service is deployed (cross-check with attestation)
CREATE OR REPLACE FUNCTION verify_service_deployed(
  p_tenant_id UUID,
  p_service_name VARCHAR,
  p_expected_version VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  deployed BOOLEAN,
  version VARCHAR,
  health_status VARCHAR,
  reason VARCHAR
) AS $$
DECLARE
  v_manifest JSONB;
  v_service_info JSONB;
BEGIN
  -- Get latest attestation
  SELECT ta.manifest_json INTO v_manifest
  FROM topology_attestations ta
  WHERE ta.tenant_id = p_tenant_id
    AND ta.expires_at > NOW()
  ORDER BY ta.epoch DESC
  LIMIT 1;

  IF v_manifest IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::VARCHAR, NULL::VARCHAR, 'No valid topology attestation found';
    RETURN;
  END IF;

  -- Extract service from manifest
  v_service_info := v_manifest -> 'services' -> p_service_name;

  IF v_service_info IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::VARCHAR, NULL::VARCHAR, 'Service not in topology attestation';
    RETURN;
  END IF;

  -- Check health status
  IF (v_service_info ->> 'healthStatus') = 'CRITICAL' THEN
    RETURN QUERY SELECT FALSE, v_service_info ->> 'version', v_service_info ->> 'healthStatus', 'Service is in CRITICAL state';
    RETURN;
  END IF;

  -- Check version if expected
  IF p_expected_version IS NOT NULL AND (v_service_info ->> 'version') != p_expected_version THEN
    RETURN QUERY SELECT FALSE, v_service_info ->> 'version', v_service_info ->> 'healthStatus', 'Version mismatch';
    RETURN;
  END IF;

  -- All checks passed
  RETURN QUERY SELECT TRUE, v_service_info ->> 'version', v_service_info ->> 'healthStatus', NULL::VARCHAR;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. Helper to cleanup expired attestations
CREATE OR REPLACE FUNCTION cleanup_expired_attestations()
RETURNS TABLE (deleted_count INT) AS $$
DECLARE
  count INT;
BEGIN
  DELETE FROM topology_attestations
  WHERE expires_at < NOW() - INTERVAL '1 day'; -- Keep for 1 day after expiry

  GET DIAGNOSTICS count = ROW_COUNT;

  RETURN QUERY SELECT count;
END;
$$ LANGUAGE plpgsql;

-- 8. View for on-call: current topology state
CREATE OR REPLACE VIEW v_current_topology_state AS
  SELECT
    ta.tenant_id,
    ta.epoch,
    ta.deployment_id,
    ta.signer_id,
    ta.signed_at,
    ta.expires_at,
    jsonb_object_keys(ta.manifest_json -> 'services') as service_name,
    ta.manifest_json -> 'services' -> jsonb_object_keys(ta.manifest_json -> 'services') as service_info
  FROM topology_attestations ta
  WHERE ta.expires_at > NOW()
  ORDER BY ta.tenant_id, ta.epoch DESC, ta.signed_at DESC;

COMMIT;
