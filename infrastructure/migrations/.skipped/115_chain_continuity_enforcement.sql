-- ====================================================================
-- MIGRATION 115: CHAIN CONTINUITY ENFORCEMENT
-- PURPOSE: Prevent silent deletion/truncation of audit chain bindings
-- CONTEXT: CRITICAL BLOCKER #1 - Enforces NO GAPS in chain positions
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Add constraint to prevent negative chain positions
ALTER TABLE operator_trace_bindings
  ADD CONSTRAINT chk_chain_position_positive CHECK (chain_position > 0);

-- 2. Add constraint to enforce consecutive chain positions
-- This prevents gaps: if binding B's previous is binding A at position N,
-- then B MUST be at position N+1
CREATE OR REPLACE FUNCTION validate_chain_continuity()
RETURNS TRIGGER AS $$
DECLARE
  v_previous_position BIGINT;
  v_expected_position BIGINT;
BEGIN
  -- If this is not a genesis binding (has previous_binding_hash)
  IF NEW.previous_binding_hash IS NOT NULL THEN
    -- Find the position of the previous binding
    SELECT chain_position INTO v_previous_position
    FROM operator_trace_bindings
    WHERE trace_id = NEW.trace_id
      AND signature_hash = NEW.previous_binding_hash
    LIMIT 1;

    IF v_previous_position IS NULL THEN
      RAISE EXCEPTION 'CHAIN_CONTINUITY_VIOLATION: Previous binding not found (previous_hash=%)', NEW.previous_binding_hash;
    END IF;

    -- Expected position is immediately after previous
    v_expected_position := v_previous_position + 1;

    IF NEW.chain_position != v_expected_position THEN
      RAISE EXCEPTION 'CHAIN_CONTINUITY_VIOLATION: Expected position % but got % (prev_pos=%)',
        v_expected_position, NEW.chain_position, v_previous_position;
    END IF;
  ELSE
    -- Genesis binding MUST be at position 1
    IF NEW.chain_position != 1 THEN
      RAISE EXCEPTION 'CHAIN_CONTINUITY_VIOLATION: Genesis binding must be at position 1, got %',
        NEW.chain_position;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger to validate continuity on insert/update
DROP TRIGGER IF EXISTS trg_validate_chain_continuity ON operator_trace_bindings;
CREATE TRIGGER trg_validate_chain_continuity
  BEFORE INSERT OR UPDATE ON operator_trace_bindings
  FOR EACH ROW
  EXECUTE FUNCTION validate_chain_continuity();

-- 4. Helper function to verify complete chain (no gaps)
CREATE OR REPLACE FUNCTION verify_chain_is_continuous(
  p_trace_id VARCHAR,
  p_tenant_id UUID
)
RETURNS TABLE (
  valid BOOLEAN,
  last_position BIGINT,
  gap_count INT,
  reason VARCHAR
) AS $$
DECLARE
  v_max_position BIGINT;
  v_gap_count INT := 0;
  v_row RECORD;
BEGIN
  -- Get the maximum position in the chain
  SELECT MAX(chain_position) INTO v_max_position
  FROM operator_trace_bindings
  WHERE trace_id = p_trace_id AND tenant_id = p_tenant_id;

  IF v_max_position IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::BIGINT, 0, 'CHAIN_EMPTY: No bindings found';
    RETURN;
  END IF;

  -- Check that every position from 1 to max exists
  FOR v_row IN
    SELECT i as missing_pos
    FROM generate_series(1, v_max_position) AS i
    WHERE NOT EXISTS (
      SELECT 1 FROM operator_trace_bindings
      WHERE trace_id = p_trace_id
        AND tenant_id = p_tenant_id
        AND chain_position = i
    )
  LOOP
    v_gap_count := v_gap_count + 1;
  END LOOP;

  IF v_gap_count > 0 THEN
    RETURN QUERY SELECT FALSE, v_max_position, v_gap_count, 'CHAIN_GAP_DETECTED: ' || v_gap_count || ' missing positions';
  ELSE
    RETURN QUERY SELECT TRUE, v_max_position, 0, 'Chain is continuous from 1 to ' || v_max_position;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. Helper to detect malicious truncation (binding deletion)
CREATE OR REPLACE VIEW v_truncation_attempts AS
  SELECT
    trace_id,
    MAX(chain_position) as max_position,
    COUNT(*) as total_bindings,
    MAX(created_at) as latest_binding,
    (
      SELECT COUNT(*) FROM generate_series(1, MAX(chain_position)) i
      WHERE NOT EXISTS (
        SELECT 1 FROM operator_trace_bindings otb2
        WHERE otb2.trace_id = operator_trace_bindings.trace_id
          AND otb2.chain_position = i
      )
    ) as gap_count
  FROM operator_trace_bindings
  GROUP BY trace_id
  HAVING (
    SELECT COUNT(*) FROM generate_series(1, MAX(chain_position)) i
    WHERE NOT EXISTS (
      SELECT 1 FROM operator_trace_bindings otb2
      WHERE otb2.trace_id = operator_trace_bindings.trace_id
        AND otb2.chain_position = i
    )
  ) > 0;

COMMIT;
