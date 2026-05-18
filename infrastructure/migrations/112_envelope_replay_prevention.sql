-- ====================================================================
-- MIGRATION 112: ENVELOPE REPLAY PREVENTION & NONCE TRACKING
-- PURPOSE: Prevent replaying signed envelopes into SSE consumers
-- CONTEXT: FIX C - Critical gap enabling envelope replay attacks
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Create table to track seen envelope nonces (for replay detection)
CREATE TABLE envelope_nonce_cache (
  nonce_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  envelope_id VARCHAR(255) NOT NULL,
  envelope_nonce VARCHAR(255) NOT NULL,
  signature_key_id VARCHAR(255), -- Which key was used to sign this envelope

  -- Expiration tracking
  expires_at TIMESTAMPTZ NOT NULL, -- When this nonce becomes invalid
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Metadata for forensics
  source_service VARCHAR(100), -- 'governance-engine', 'replay-authority', etc.
  consumer_id VARCHAR(255), -- Which consumer/endpoint processed this

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Unique constraint on (tenant_id, envelope_nonce) to prevent duplicate processing
CREATE UNIQUE INDEX idx_nonce_uniqueness
  ON envelope_nonce_cache (tenant_id, envelope_nonce);

-- 3. Index for fast nonce lookup during verification
CREATE INDEX idx_nonce_verification
  ON envelope_nonce_cache (tenant_id, envelope_nonce)
  WHERE expires_at > NOW();

-- 4. Index for expiration cleanup (find stale nonces)
CREATE INDEX idx_nonce_expiration
  ON envelope_nonce_cache (expires_at)
  WHERE expires_at < NOW();

-- 5. Index for forensic queries (which consumer saw what)
CREATE INDEX idx_nonce_consumer
  ON envelope_nonce_cache (tenant_id, consumer_id, seen_at DESC);

-- 6. Helper function to check if envelope has been seen before (replay detection)
CREATE OR REPLACE FUNCTION has_envelope_been_seen(
  p_tenant_id UUID,
  p_envelope_nonce VARCHAR
)
RETURNS TABLE (
  seen BOOLEAN,
  expires_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TRUE as seen,
    enf.expires_at,
    enf.seen_at
  FROM envelope_nonce_cache enf
  WHERE enf.tenant_id = p_tenant_id
    AND enf.envelope_nonce = p_envelope_nonce
    AND enf.expires_at > NOW()
  LIMIT 1;

  -- If no row found, return false (not seen before)
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. Helper function to register a new envelope nonce (prevent replay)
CREATE OR REPLACE FUNCTION register_envelope_nonce(
  p_tenant_id UUID,
  p_envelope_id VARCHAR,
  p_envelope_nonce VARCHAR,
  p_signature_key_id VARCHAR,
  p_expires_at TIMESTAMPTZ,
  p_source_service VARCHAR DEFAULT NULL,
  p_consumer_id VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  registered BOOLEAN,
  reason VARCHAR
) AS $$
BEGIN
  -- Attempt to insert the nonce
  INSERT INTO envelope_nonce_cache (
    tenant_id, envelope_id, envelope_nonce, signature_key_id,
    expires_at, source_service, consumer_id
  ) VALUES (
    p_tenant_id, p_envelope_id, p_envelope_nonce, p_signature_key_id,
    p_expires_at, p_source_service, p_consumer_id
  );

  RETURN QUERY SELECT TRUE, 'Nonce registered successfully';
EXCEPTION
  WHEN unique_violation THEN
    -- Nonce already exists (replay attempt)
    RETURN QUERY SELECT FALSE, 'REPLAY_DETECTED: Nonce has already been processed';
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, 'Error registering nonce: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- 8. Helper function to clean up expired nonces (housekeeping)
CREATE OR REPLACE FUNCTION cleanup_expired_nonce_cache()
RETURNS TABLE (deleted_count INT) AS $$
DECLARE
  count INT;
BEGIN
  DELETE FROM envelope_nonce_cache
  WHERE expires_at < NOW() - INTERVAL '1 hour'; -- Keep for 1 hour after expiry

  GET DIAGNOSTICS count = ROW_COUNT;

  RETURN QUERY SELECT count;
END;
$$ LANGUAGE plpgsql;

-- 9. Helper function to audit envelope replays (for incident response)
CREATE OR REPLACE FUNCTION get_replay_attempts(
  p_tenant_id UUID,
  p_window_minutes INT DEFAULT 60
)
RETURNS TABLE (
  envelope_nonce VARCHAR,
  attempt_count INT,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  consumers TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    enf.envelope_nonce,
    COUNT(*)::INT as attempt_count,
    MIN(enf.seen_at) as first_seen,
    MAX(enf.seen_at) as last_seen,
    ARRAY_AGG(DISTINCT enf.consumer_id) as consumers
  FROM envelope_nonce_cache enf
  WHERE enf.tenant_id = p_tenant_id
    AND enf.seen_at > NOW() - INTERVAL '1 minute' * p_window_minutes
  GROUP BY enf.envelope_nonce
  HAVING COUNT(*) > 1
  ORDER BY last_seen DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 10. View for on-call: recent replay attempts
CREATE OR REPLACE VIEW v_envelope_replays AS
  SELECT
    envelope_nonce,
    COUNT(*) as attempt_count,
    MIN(seen_at) as first_attempt,
    MAX(seen_at) as latest_attempt,
    ARRAY_AGG(DISTINCT consumer_id ORDER BY consumer_id) as consumers,
    ARRAY_AGG(DISTINCT source_service ORDER BY source_service) as services
  FROM envelope_nonce_cache
  WHERE seen_at > NOW() - INTERVAL '1 hour'
  GROUP BY envelope_nonce
  HAVING COUNT(*) > 1
  ORDER BY latest_attempt DESC;

COMMIT;
