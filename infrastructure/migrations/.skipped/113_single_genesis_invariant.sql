-- ====================================================================
-- MIGRATION 113: SINGLE-GENESIS INVARIANT ENFORCEMENT
-- PURPOSE: Enforce exactly one genesis binding (previous_binding_hash IS NULL) per trace
-- CONTEXT: MANDATORY BLOCKER #1 - Prevents multiple chain origins
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- Drop the incorrect genesis constraint from Migration 111 if it exists
-- (it only constrains chain_position = 1, not all genesis blocks)
DROP INDEX IF EXISTS idx_trace_genesis_single;

-- Add proper single-genesis constraint: each trace has exactly ONE binding with no previous
-- This prevents a trace from having multiple chain origins
CREATE UNIQUE INDEX idx_trace_single_genesis
  ON operator_trace_bindings (trace_id)
  WHERE previous_binding_hash IS NULL;

-- Helper function to verify single-genesis invariant for a trace
CREATE OR REPLACE FUNCTION verify_single_genesis(
  p_trace_id VARCHAR,
  p_tenant_id UUID
)
RETURNS TABLE (
  valid BOOLEAN,
  genesis_count INT,
  genesis_binding_id UUID,
  reason VARCHAR
) AS $$
DECLARE
  v_genesis_count INT;
  v_genesis_id UUID;
BEGIN
  SELECT COUNT(*), MAX(id) INTO v_genesis_count, v_genesis_id
  FROM operator_trace_bindings
  WHERE trace_id = p_trace_id
    AND tenant_id = p_tenant_id
    AND previous_binding_hash IS NULL;

  IF v_genesis_count = 0 THEN
    RETURN QUERY SELECT FALSE, 0, NULL::UUID, 'NO_GENESIS_FOUND: Trace has no origin binding';
  ELSIF v_genesis_count > 1 THEN
    RETURN QUERY SELECT FALSE, v_genesis_count, NULL::UUID, 'MULTIPLE_GENESIS_DETECTED: Trace has ' || v_genesis_count || ' origin bindings';
  ELSE
    RETURN QUERY SELECT TRUE, 1, v_genesis_id, 'Single genesis binding verified';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to detect genesis forks in audit logs (for forensics)
CREATE OR REPLACE VIEW v_genesis_fork_attempts AS
  SELECT
    trace_id,
    COUNT(*) as genesis_count,
    ARRAY_AGG(id ORDER BY created_at) as genesis_binding_ids,
    MIN(created_at) as first_genesis,
    MAX(created_at) as latest_genesis,
    'GENESIS_FORK_DETECTED'::VARCHAR as alert_type
  FROM operator_trace_bindings
  WHERE previous_binding_hash IS NULL
  GROUP BY trace_id
  HAVING COUNT(*) > 1
  ORDER BY latest_genesis DESC;

COMMIT;
