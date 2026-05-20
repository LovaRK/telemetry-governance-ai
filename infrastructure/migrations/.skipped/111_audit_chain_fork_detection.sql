-- ====================================================================
-- MIGRATION 111: AUDIT CHAIN FORK DETECTION & ENFORCEMENT
-- PURPOSE: Enforce single-successor invariant to prevent ledger forks
-- CONTEXT: FIX B - Critical gap preventing undetected chain forks
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Add explicit previous_binding_hash column to make chain pointers explicit
-- This replaces implicit ordering and enables uniqueness constraint
ALTER TABLE operator_trace_bindings
  ADD COLUMN previous_binding_hash VARCHAR(64), -- Hash of the binding this one points to
  ADD COLUMN auth_context JSONB, -- Canonical auth context from the binding
  ADD COLUMN action_payload JSONB; -- Canonical action payload

-- 2. For existing rows, set previous_binding_hash by looking at the previous binding in the chain
-- This backfills the relationship for all existing bindings
UPDATE operator_trace_bindings otb
  SET previous_binding_hash = (
    SELECT signature_hash
    FROM operator_trace_bindings otb_prev
    WHERE otb_prev.trace_id = otb.trace_id
      AND otb_prev.chain_position = otb.chain_position - 1
    LIMIT 1
  );

-- 3. Add operator_hash column if not present (for explicit tracking)
ALTER TABLE operator_trace_bindings
  ADD COLUMN operator_hash VARCHAR(255),
  ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- 4. CRITICAL: Unique constraint enforcing single-successor invariant
-- For each (trace_id, previous_binding_hash) pair, there can be at most ONE binding
-- This prevents forks: if binding B and C both point to A, the constraint fails
CREATE UNIQUE INDEX idx_trace_fork_prevention
  ON operator_trace_bindings (trace_id, previous_binding_hash)
  WHERE previous_binding_hash IS NOT NULL;

-- 5. Allow multiple genesis blocks (previous_binding_hash IS NULL) per trace only at position 1
-- This prevents two bindings from both being genesis blocks
CREATE UNIQUE INDEX idx_trace_genesis_single
  ON operator_trace_bindings (trace_id)
  WHERE previous_binding_hash IS NULL AND chain_position = 1;

-- 6. Index for fast fork detection queries (find all branches from a given point)
CREATE INDEX idx_fork_detection_query
  ON operator_trace_bindings (trace_id, previous_binding_hash, chain_position DESC)
  WHERE previous_binding_hash IS NOT NULL;

-- 7. Helper function to detect if a trace has forked
CREATE OR REPLACE FUNCTION detect_trace_fork(p_trace_id VARCHAR)
RETURNS TABLE (
  has_fork BOOLEAN,
  fork_point_hash VARCHAR,
  successor_count INT,
  branch_ids UUID[]
) AS $$
BEGIN
  -- Find any previous_binding_hash that has multiple successors (indicates fork)
  RETURN QUERY
  SELECT
    TRUE as has_fork,
    otb.previous_binding_hash as fork_point_hash,
    COUNT(*)::INT as successor_count,
    ARRAY_AGG(otb.id) as branch_ids
  FROM operator_trace_bindings otb
  WHERE otb.trace_id = p_trace_id
  GROUP BY otb.previous_binding_hash
  HAVING COUNT(*) > 1;

  -- If no forks found, return false
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::VARCHAR, 0, NULL::UUID[];
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 8. Function to verify chain integrity including fork detection
CREATE OR REPLACE FUNCTION verify_chain_has_no_forks(p_trace_id VARCHAR, p_tenant_id UUID)
RETURNS TABLE (
  valid BOOLEAN,
  reason VARCHAR
) AS $$
DECLARE
  v_fork_count INT;
BEGIN
  -- Count bindings with the same (trace_id, previous_binding_hash) pair
  SELECT COUNT(*) INTO v_fork_count
  FROM (
    SELECT previous_binding_hash, COUNT(*) as cnt
    FROM operator_trace_bindings
    WHERE trace_id = p_trace_id AND tenant_id = p_tenant_id AND previous_binding_hash IS NOT NULL
    GROUP BY previous_binding_hash
    HAVING COUNT(*) > 1
  ) forks;

  IF v_fork_count > 0 THEN
    RETURN QUERY SELECT FALSE, 'CHAIN_FORK_DETECTED: ' || v_fork_count || ' fork points found';
  ELSE
    RETURN QUERY SELECT TRUE, 'Chain has no forks';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 9. Function to safely append a new binding (enforces fork prevention via constraint)
CREATE OR REPLACE FUNCTION append_binding_to_chain(
  p_binding_id VARCHAR,
  p_trace_id VARCHAR,
  p_tenant_id UUID,
  p_previous_binding_hash VARCHAR,
  p_signature_hash VARCHAR,
  p_operator_hash VARCHAR,
  p_action_type VARCHAR,
  p_auth_context JSONB,
  p_action_payload JSONB,
  p_signed_at TIMESTAMPTZ
)
RETURNS TABLE (
  success BOOLEAN,
  new_binding_id UUID,
  chain_position BIGINT,
  reason VARCHAR
) AS $$
DECLARE
  v_binding_id UUID;
  v_position BIGINT;
BEGIN
  -- Attempt to insert new binding
  -- The unique constraint on (trace_id, previous_binding_hash) will prevent forks
  INSERT INTO operator_trace_bindings (
    binding_id,
    trace_id,
    tenant_id,
    previous_binding_hash,
    signature_hash,
    operator_hash,
    action_type,
    auth_context,
    action_payload,
    signed_at,
    operator_session_snapshot, -- Required column from migration 107
    authorization_context
  ) VALUES (
    p_binding_id,
    p_trace_id,
    p_tenant_id,
    p_previous_binding_hash,
    p_signature_hash,
    p_operator_hash,
    p_action_type,
    p_auth_context,
    p_action_payload,
    p_signed_at,
    '{}'::JSONB, -- Placeholder for operator_session_snapshot
    NULL -- authorization_context optional
  )
  RETURNING
    operator_trace_bindings.id,
    operator_trace_bindings.chain_position
  INTO v_binding_id, v_position;

  RETURN QUERY SELECT TRUE, v_binding_id, v_position, 'Binding appended successfully';
EXCEPTION
  WHEN unique_violation THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, 'FORK_PREVENTION_TRIGGERED: Duplicate successor detected for this previous_binding_hash';
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, 'Error appending binding: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- 10. Audit view for detecting suspicious fork attempts
CREATE OR REPLACE VIEW v_fork_attempts AS
  SELECT
    trace_id,
    previous_binding_hash,
    COUNT(*) as successor_count,
    ARRAY_AGG(id ORDER BY chain_position) as binding_ids,
    MAX(created_at) as latest_attempt,
    'FORK_DETECTED'::VARCHAR as alert_type
  FROM operator_trace_bindings
  WHERE previous_binding_hash IS NOT NULL
  GROUP BY trace_id, previous_binding_hash
  HAVING COUNT(*) > 1
  ORDER BY latest_attempt DESC;

COMMIT;
