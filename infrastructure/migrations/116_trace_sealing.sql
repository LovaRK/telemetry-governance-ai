-- ====================================================================
-- MIGRATION 116: TRACE SEALING SEMANTICS
-- PURPOSE: Prevent post-fact mutation of completed traces
-- CONTEXT: CRITICAL BLOCKER #3 - Defines trace lifecycle boundaries
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Create table to track trace lifecycle state
CREATE TABLE trace_lifecycle_states (
  trace_id VARCHAR(255) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('OPEN', 'SEALED')), -- OPEN = accepting new bindings, SEALED = immutable
  sealed_at TIMESTAMPTZ, -- When trace was sealed (NULL if still OPEN)
  seal_reason VARCHAR(255), -- Why was this trace sealed? ('COMPLETION', 'TTL_EXPIRED', 'OPERATOR_SEALED', etc.)
  operator_id VARCHAR(255), -- Which operator sealed this (if applicable)
  final_binding_position BIGINT, -- Position of last binding in sealed trace
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Index for fast status lookup
CREATE INDEX idx_trace_status ON trace_lifecycle_states(tenant_id, status);
CREATE INDEX idx_trace_seal_time ON trace_lifecycle_states(sealed_at) WHERE sealed_at IS NOT NULL;

-- 3. Add trace_status to audit bindings (denormalized for verification speed)
ALTER TABLE operator_trace_bindings
  ADD COLUMN trace_status VARCHAR(20) DEFAULT 'OPEN',
  ADD CONSTRAINT fk_trace_status_check CHECK (trace_status IN ('OPEN', 'SEALED'));

-- 4. Trigger to prevent mutations to sealed traces
CREATE OR REPLACE FUNCTION prevent_mutation_of_sealed_trace()
RETURNS TRIGGER AS $$
DECLARE
  v_trace_status VARCHAR;
BEGIN
  -- Check if trace is sealed
  SELECT status INTO v_trace_status
  FROM trace_lifecycle_states
  WHERE trace_id = NEW.trace_id;

  IF v_trace_status = 'SEALED' THEN
    RAISE EXCEPTION 'TRACE_SEALED: Cannot append binding to sealed trace %', NEW.trace_id;
  END IF;

  -- Update denormalized status for fast lookup
  NEW.trace_status := COALESCE(v_trace_status, 'OPEN');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger on insert/update
DROP TRIGGER IF EXISTS trg_prevent_sealed_mutation ON operator_trace_bindings;
CREATE TRIGGER trg_prevent_sealed_mutation
  BEFORE INSERT OR UPDATE ON operator_trace_bindings
  FOR EACH ROW
  EXECUTE FUNCTION prevent_mutation_of_sealed_trace();

-- 6. Helper function to seal a trace (operator-initiated or automatic)
CREATE OR REPLACE FUNCTION seal_trace(
  p_trace_id VARCHAR,
  p_tenant_id UUID,
  p_reason VARCHAR,
  p_operator_id VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  sealed BOOLEAN,
  final_position BIGINT,
  reason VARCHAR
) AS $$
DECLARE
  v_max_position BIGINT;
BEGIN
  -- Get the final position of the trace
  SELECT MAX(chain_position) INTO v_max_position
  FROM operator_trace_bindings
  WHERE trace_id = p_trace_id AND tenant_id = p_tenant_id;

  IF v_max_position IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::BIGINT, 'TRACE_NOT_FOUND: No bindings in trace';
    RETURN;
  END IF;

  -- Insert lifecycle state
  INSERT INTO trace_lifecycle_states (
    trace_id, tenant_id, status, sealed_at, seal_reason, operator_id, final_binding_position
  ) VALUES (
    p_trace_id, p_tenant_id, 'SEALED', NOW(), p_reason, p_operator_id, v_max_position
  )
  ON CONFLICT (trace_id) DO UPDATE SET
    status = 'SEALED',
    sealed_at = NOW(),
    seal_reason = EXCLUDED.seal_reason,
    operator_id = EXCLUDED.operator_id,
    final_binding_position = EXCLUDED.final_binding_position,
    updated_at = NOW();

  -- Update denormalized status in bindings table
  UPDATE operator_trace_bindings
  SET trace_status = 'SEALED'
  WHERE trace_id = p_trace_id AND tenant_id = p_tenant_id;

  RETURN QUERY SELECT TRUE, v_max_position, 'Trace sealed successfully';
END;
$$ LANGUAGE plpgsql;

-- 7. Helper to verify trace is still OPEN
CREATE OR REPLACE FUNCTION verify_trace_is_open(
  p_trace_id VARCHAR,
  p_tenant_id UUID
)
RETURNS TABLE (
  open BOOLEAN,
  status VARCHAR,
  sealed_at TIMESTAMPTZ,
  reason VARCHAR
) AS $$
DECLARE
  v_status VARCHAR;
  v_sealed_at TIMESTAMPTZ;
BEGIN
  SELECT status, sealed_at INTO v_status, v_sealed_at
  FROM trace_lifecycle_states
  WHERE trace_id = p_trace_id AND tenant_id = p_tenant_id;

  IF v_status IS NULL THEN
    -- Trace never explicitly sealed—treat as OPEN
    RETURN QUERY SELECT TRUE, 'OPEN'::VARCHAR, NULL::TIMESTAMPTZ, 'Trace state not yet recorded';
  ELSIF v_status = 'OPEN' THEN
    RETURN QUERY SELECT TRUE, 'OPEN'::VARCHAR, NULL::TIMESTAMPTZ, 'Trace is accepting new bindings';
  ELSE
    RETURN QUERY SELECT FALSE, v_status, v_sealed_at, 'Trace is sealed—no new bindings allowed';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 8. Helper to auto-seal traces older than TTL
CREATE OR REPLACE FUNCTION auto_seal_expired_traces(
  p_trace_ttl_days INT DEFAULT 7
)
RETURNS TABLE (
  sealed_count INT,
  reason VARCHAR
) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Seal traces that have not received a binding in TTL period
  UPDATE trace_lifecycle_states tls
  SET status = 'SEALED',
      sealed_at = NOW(),
      seal_reason = 'AUTO_SEALED: Exceeded TTL'
  WHERE status = 'OPEN'
    AND (
      SELECT MAX(created_at) FROM operator_trace_bindings otb
      WHERE otb.trace_id = tls.trace_id
    ) < NOW() - INTERVAL '1 day' * p_trace_ttl_days;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_count, 'Automatically sealed ' || v_count || ' expired traces';
END;
$$ LANGUAGE plpgsql;

-- 9. View for on-call: recently sealed traces
CREATE OR REPLACE VIEW v_sealed_traces_audit AS
  SELECT
    trace_id,
    tenant_id,
    sealed_at,
    seal_reason,
    operator_id,
    final_binding_position,
    NOW() - sealed_at as time_since_seal,
    (
      SELECT COUNT(*) FROM operator_trace_bindings
      WHERE trace_id = trace_lifecycle_states.trace_id
    ) as total_bindings
  FROM trace_lifecycle_states
  WHERE status = 'SEALED'
    AND sealed_at > NOW() - INTERVAL '24 hours'
  ORDER BY sealed_at DESC;

COMMIT;
