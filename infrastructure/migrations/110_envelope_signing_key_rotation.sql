-- ====================================================================
-- MIGRATION 110: ENVELOPE SIGNING KEY ROTATION & VERSIONING
-- PURPOSE: Enable HMAC key rotation without invalidating historical envelopes
-- CRITICAL GAP: Previous implementation had no key versioning
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Create envelope_signing_keys table for key rotation management
CREATE TABLE envelope_signing_keys (
  key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,

  -- Key material
  key_material_encrypted BYTEA NOT NULL, -- Encrypted with KMS (never plain text in DB)
  key_algorithm VARCHAR(32) NOT NULL DEFAULT 'HMAC_SHA256_V1',

  -- Lifecycle state
  is_active BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,

  -- Operational windows
  can_sign BOOLEAN NOT NULL DEFAULT true, -- New signatures use this key?
  can_verify BOOLEAN NOT NULL DEFAULT true, -- Verification accepts this key?

  -- Metadata
  rotation_reason VARCHAR(255), -- Why was this key rotated? ('SCHEDULED' | 'COMPROMISE' | 'ALGORITHM_CHANGE')
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_lifecycle CHECK (
    (retired_at IS NULL) OR (activated_at IS NOT NULL AND retired_at > activated_at)
  )
);

-- 2. Index for fast active key lookup (signing)
CREATE UNIQUE INDEX idx_active_signing_key
  ON envelope_signing_keys (tenant_id)
  WHERE is_active = true AND can_sign = true AND retired_at IS NULL;

-- 3. Index for verification fallback (check active + previous keys)
CREATE INDEX idx_verification_keys
  ON envelope_signing_keys (tenant_id, key_algorithm)
  WHERE can_verify = true AND retired_at IS NULL;

-- 4. Index for key rotation auditing
CREATE INDEX idx_key_lifecycle
  ON envelope_signing_keys (tenant_id, created_at DESC)
  WHERE retired_at IS NULL;

-- 5. Helper function to rotate keys (creates new key, retires old)
CREATE OR REPLACE FUNCTION rotate_envelope_signing_key(
  p_tenant_id UUID,
  p_new_key_material_encrypted BYTEA,
  p_rotation_reason VARCHAR DEFAULT 'SCHEDULED'
)
RETURNS UUID AS $$
DECLARE
  v_old_key_id UUID;
  v_new_key_id UUID;
  v_retirement_grace_days INT := 30; -- Allow verification of old key for 30 days post-rotation
BEGIN
  -- 1. Retire active key (keep it for verification for grace period)
  UPDATE envelope_signing_keys
  SET is_active = false,
      can_sign = false,
      retired_at = NOW() + INTERVAL '1 day' * v_retirement_grace_days,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id AND is_active = true RETURNING key_id INTO v_old_key_id;

  -- 2. Create new active key
  INSERT INTO envelope_signing_keys (
    tenant_id, key_material_encrypted, key_algorithm,
    is_active, activated_at, can_sign, can_verify,
    rotation_reason
  ) VALUES (
    p_tenant_id, p_new_key_material_encrypted, 'HMAC_SHA256_V1',
    true, NOW(), true, true,
    p_rotation_reason
  ) RETURNING key_id INTO v_new_key_id;

  -- 3. Log key rotation event
  INSERT INTO audit_log (tenant_id, action, details, created_at)
  VALUES (p_tenant_id, 'KEY_ROTATED',
    jsonb_build_object(
      'old_key_id', v_old_key_id,
      'new_key_id', v_new_key_id,
      'reason', p_rotation_reason,
      'grace_period_days', v_retirement_grace_days
    ), NOW());

  RETURN v_new_key_id;
END;
$$ LANGUAGE plpgsql;

-- 6. Helper function to get all valid keys for verification (active + recent previous)
CREATE OR REPLACE FUNCTION get_verification_keys(p_tenant_id UUID)
RETURNS TABLE (key_id UUID, key_material_encrypted BYTEA, key_algorithm VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT k.key_id, k.key_material_encrypted, k.key_algorithm
  FROM envelope_signing_keys k
  WHERE k.tenant_id = p_tenant_id
    AND k.can_verify = true
    AND k.key_algorithm = 'HMAC_SHA256_V1'
    AND (k.retired_at IS NULL OR k.retired_at > NOW())
  ORDER BY k.is_active DESC, k.activated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 7. Helper function to get active signing key
CREATE OR REPLACE FUNCTION get_active_signing_key(p_tenant_id UUID)
RETURNS TABLE (key_id UUID, key_material_encrypted BYTEA, key_algorithm VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT k.key_id, k.key_material_encrypted, k.key_algorithm
  FROM envelope_signing_keys k
  WHERE k.tenant_id = p_tenant_id
    AND k.is_active = true
    AND k.can_sign = true
    AND k.retired_at IS NULL
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- 8. Audit table to track verification failures (for compromise detection)
CREATE TABLE envelope_signature_failures (
  failure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  envelope_id UUID,
  attempted_key_id UUID,
  failure_reason VARCHAR(255), -- 'KEY_NOT_FOUND' | 'SIGNATURE_MISMATCH' | 'KEY_EXPIRED'
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signature_failures
  ON envelope_signature_failures (tenant_id, recorded_at DESC);

COMMIT;
