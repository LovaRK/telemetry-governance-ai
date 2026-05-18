-- ====================================================================
-- MIGRATION 109: SYSTEMIC FAILURE SIGNAL AGGREGATION TABLE
-- PURPOSE: Enable cross-trace anomaly correlation to prevent remediation storms
-- CONTEXT: Phase 2A.1 — Systemic Correlation Layer (blocks Phase 2B SSE)
-- SYSTEM TIME: May 18, 2026
-- ====================================================================

START TRANSACTION;

-- 1. Create systemic_failure_signals table for cross-trace correlation
CREATE TABLE systemic_failure_signals (
  signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,

  -- Scope identification
  topology_hash VARCHAR(64) NOT NULL, -- Which worker pool / deployment window
  time_window_start TIMESTAMPTZ NOT NULL,
  time_window_duration_seconds INT NOT NULL DEFAULT 30,

  -- Prevalence metrics
  affected_trace_count INT NOT NULL DEFAULT 0,
  sampled_trace_ids TEXT[] DEFAULT '{}', -- Representative sample for investigation

  -- Failure signature rates (0-1 scale)
  orphan_rate NUMERIC(5,4) NOT NULL DEFAULT 0, -- % traces with orphan spans
  retry_storm_rate NUMERIC(5,4) NOT NULL DEFAULT 0, -- % traces with >5 retries
  coherence_failure_rate NUMERIC(5,4) NOT NULL DEFAULT 0, -- % with ordering violations
  temporal_anomaly_rate NUMERIC(5,4) NOT NULL DEFAULT 0, -- % with clock skew
  cardinality_explosion_rate NUMERIC(5,4) NOT NULL DEFAULT 0, -- % exceeding threshold

  -- Automation gate decision
  systemic_trust_level VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN', -- HEALTHY|DEGRADED|COLLAPSED
  allow_local_remediation BOOLEAN NOT NULL DEFAULT false,
  escalation_required BOOLEAN NOT NULL DEFAULT false,

  -- Root cause analysis
  root_cause VARCHAR(50), -- DEPLOYMENT|INFRASTRUCTURE|UNKNOWN
  correlated_events JSONB DEFAULT '[]'::jsonb, -- [{type, evidence: [...]}]

  -- Metadata
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for fast lookups during remediation gate checks
CREATE INDEX idx_systemic_topology_observed
  ON systemic_failure_signals (tenant_id, topology_hash, observed_at DESC)
  WHERE systemic_trust_level != 'HEALTHY';

CREATE INDEX idx_systemic_escalation_required
  ON systemic_failure_signals (tenant_id, escalation_required, observed_at DESC)
  WHERE escalation_required = true;

-- 3. Index for recent signals (aggregation window queries)
CREATE INDEX idx_systemic_recent
  ON systemic_failure_signals (tenant_id, observed_at DESC)
  WHERE observed_at > NOW() - INTERVAL '5 minutes';

-- 4. Helper function to get latest systemic signal for a topology+window
CREATE OR REPLACE FUNCTION get_latest_systemic_signal(
  p_tenant_id UUID,
  p_topology_hash VARCHAR,
  p_observed_after TIMESTAMPTZ
)
RETURNS systemic_failure_signals AS $$
BEGIN
  RETURN (
    SELECT * FROM systemic_failure_signals
    WHERE tenant_id = p_tenant_id
      AND topology_hash = p_topology_hash
      AND observed_at > p_observed_after
    ORDER BY observed_at DESC
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. Helper function to check if remediation is allowed given systemic state
CREATE OR REPLACE FUNCTION can_execute_remediation(
  p_tenant_id UUID,
  p_topology_hash VARCHAR,
  p_observed_at TIMESTAMPTZ,
  p_proposed_action VARCHAR DEFAULT NULL
)
RETURNS TABLE (allowed BOOLEAN, reason VARCHAR) AS $$
DECLARE
  v_signal systemic_failure_signals;
BEGIN
  -- Get latest systemic signal for this topology in the observation window
  SELECT * INTO v_signal
  FROM systemic_failure_signals
  WHERE tenant_id = p_tenant_id
    AND topology_hash = p_topology_hash
    AND observed_at > (p_observed_at - INTERVAL '30 seconds')
  ORDER BY observed_at DESC
  LIMIT 1;

  -- If no signal, default to allowing based on trace-level verdict
  IF v_signal IS NULL THEN
    RETURN QUERY SELECT true, 'No systemic signal detected; use trace-level verdict';
    RETURN;
  END IF;

  -- COLLAPSED → always escalate, never automate
  IF v_signal.systemic_trust_level = 'COLLAPSED' THEN
    RETURN QUERY SELECT false, 'SYSTEMIC_COLLAPSE: escalation required, no automation';
    RETURN;
  END IF;

  -- DEGRADED → only allow non-disruptive actions
  IF v_signal.systemic_trust_level = 'DEGRADED' THEN
    IF p_proposed_action IS NULL OR p_proposed_action IN ('CACHE_INVALIDATE', 'RETRY_BACKOFF', 'LOG_ONLY') THEN
      RETURN QUERY SELECT true, 'SYSTEMIC_DEGRADED: only non-disruptive actions permitted';
    ELSE
      RETURN QUERY SELECT false, 'SYSTEMIC_DEGRADED: aggressive remediation blocked (escalate to SRE)';
    END IF;
    RETURN;
  END IF;

  -- HEALTHY → allow automation to proceed
  IF v_signal.systemic_trust_level = 'HEALTHY' THEN
    RETURN QUERY SELECT true, 'Systemic state is healthy; local remediation permitted';
    RETURN;
  END IF;

  -- Default: unknown state → escalate
  RETURN QUERY SELECT false, 'UNKNOWN systemic state; escalate to SRE';
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. View for on-call dashboard (recent escalations)
CREATE OR REPLACE VIEW v_escalation_required AS
  SELECT
    signal_id,
    tenant_id,
    topology_hash,
    affected_trace_count,
    systemic_trust_level,
    root_cause,
    observed_at,
    correlated_events
  FROM systemic_failure_signals
  WHERE escalation_required = true
    AND observed_at > NOW() - INTERVAL '24 hours'
  ORDER BY observed_at DESC;

COMMIT;
