-- ============================================================
-- Migration 102_phase6_governance_observability.sql
-- Governance Observability Infrastructure for Telemetry & Audit Replay
-- Date: 2026-05-18
-- ============================================================
-- Phase 6: Build operational visibility into governance mutations
-- This enables audit trails, mutation telemetry, and time-travel queries

-- ============================================================
-- 1. GOVERNANCE MUTATION JOURNAL (Event Sourcing)
-- ============================================================
-- Immutable append-only log of every governance action
-- Enables time-travel trust score reconstruction

CREATE TABLE IF NOT EXISTS governance_mutation_journal (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,

    -- Event classification
    event_type VARCHAR(50) NOT NULL CHECK (
        event_type IN (
            'GOVERNANCE_REVIEW_SUBMITTED',      -- Human review action initiated
            'GOVERNANCE_STATE_TRANSITION',      -- Review status changed (PROPOSED→APPROVED, etc.)
            'GOVERNANCE_VERSION_COLLISION',     -- 409 STATE_VERSION_MISMATCH detected
            'GOVERNANCE_RETRY_AFTER_REFRESH',   -- Mutation retried after refresh
            'GOVERNANCE_CACHE_DESYNC',          -- Invalidation failed after mutation success
            'GOVERNANCE_RATE_LIMITED',          -- 429 cooldown triggered
            'GOVERNANCE_FORBIDDEN_TRANSITION',  -- 422 FORBIDDEN_STATE_TRANSITION
            'GOVERNANCE_MUTATION_SUCCESS',      -- Mutation succeeded + invalidation succeeded
            'GOVERNANCE_MUTATION_ABANDONED',    -- User abandoned action mid-flow
            'GOVERNANCE_APPROVAL_EXPIRED',      -- Approval reached expiry threshold
            'GOVERNANCE_CAPABILITY_CHANGED',    -- canApprove/canReject/canEscalate changed
            'CONFIDENCE_RECOVERY_MILESTONE'     -- Recovery milestone achieved (7d/14d/30d)
        )
    ),

    -- Governance action context
    action_intent VARCHAR(50) CHECK (
        action_intent IS NULL OR
        action_intent IN ('approve_decision', 'reject_decision', 'escalate_decision', 'request_reanalysis')
    ),

    -- State machine details
    from_state VARCHAR(50),  -- Previous state (e.g., PROPOSED)
    to_state VARCHAR(50),    -- New state (e.g., APPROVED)

    -- Mutation context
    mutation_id UUID,        -- Idempotency key
    reviewer_id VARCHAR(255),

    -- Timing metrics (populated by client mutation hooks)
    client_initiated_at TIMESTAMP WITH TIME ZONE,
    client_mutation_duration_ms INT,           -- Client-side mutation latency

    -- API response details
    api_response_code INT,
    api_error_code VARCHAR(50),                -- e.g., STATE_VERSION_MISMATCH, GOVERNANCE_RATE_LIMIT
    api_response_duration_ms INT,              -- Server latency for this mutation

    -- State after mutation
    effective_confidence NUMERIC(3, 2),        -- Confidence score after this mutation
    confidence_band VARCHAR(20),               -- Trust band after mutation
    governance_cap NUMERIC(3, 2),              -- Governance cap applied
    is_capped BOOLEAN,
    expected_version VARCHAR(64),              -- Version hash that was sent
    actual_version VARCHAR(64),                -- Version hash that matched/rejected

    -- Recovery state if applicable
    recovery_score NUMERIC(3, 2),
    consecutive_stable_days INT,

    -- Operator context
    operator_session_id UUID,                  -- Groups related mutations in a session
    blocking_reason VARCHAR(255),              -- Why action was blocked (if blocked)

    -- Audit metadata
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT no_same_state_transitions CHECK (from_state IS NULL OR from_state != to_state)
);

CREATE INDEX IF NOT EXISTS idx_mutation_journal_index_name ON governance_mutation_journal(index_name);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_event_type ON governance_mutation_journal(event_type);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_recorded_at ON governance_mutation_journal(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_reviewer_id ON governance_mutation_journal(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_operator_session ON governance_mutation_journal(operator_session_id);

-- ============================================================
-- 2. GOVERNANCE TELEMETRY (Metrics & Timing)
-- ============================================================
-- Aggregated performance metrics, refresh counts, stale durations
-- Enables detection of systemic failures (e.g., invalidation floods)

CREATE TABLE IF NOT EXISTS governance_telemetry (
    telemetry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,
    measurement_window TIMESTAMP WITH TIME ZONE NOT NULL,  -- Hour or day bucket

    -- Mutation counts by type
    mutation_attempts INT NOT NULL DEFAULT 0,
    mutation_successes INT NOT NULL DEFAULT 0,
    mutation_failures INT NOT NULL DEFAULT 0,

    -- Failure breakdown
    version_collisions INT NOT NULL DEFAULT 0,             -- 409 collisions
    forbidden_transitions INT NOT NULL DEFAULT 0,          -- 422 rejections
    rate_limit_hits INT NOT NULL DEFAULT 0,                -- 429 cooldowns

    -- Retry metrics
    mutations_requiring_refresh INT NOT NULL DEFAULT 0,    -- Refresh-and-retry flow triggered
    post_refresh_success_rate NUMERIC(3, 2),               -- % of refresh-retries that succeeded

    -- Invalidation health
    invalidation_failures INT NOT NULL DEFAULT 0,          -- Mutations succeeded but invalidation failed
    max_stale_duration_minutes INT,                        -- Longest stale period detected
    mutations_with_stale_state INT NOT NULL DEFAULT 0,     -- Count of mutation success + invalid fail

    -- Query cache metrics
    trust_inspection_queries INT NOT NULL DEFAULT 0,
    avg_inspection_latency_ms INT,
    trust_inspection_errors INT NOT NULL DEFAULT 0,

    -- Operator metrics
    unique_reviewers INT NOT NULL DEFAULT 0,
    avg_reviewer_session_duration_minutes INT,
    operations_abandoned INT NOT NULL DEFAULT 0,           -- Mutations started but not completed
    abandon_rate_pct NUMERIC(3, 2),                        -- % of interactions abandoned

    -- Cooldown state
    active_cooldown_counts INT NOT NULL DEFAULT 0,         -- Current # of indexes on cooldown

    -- Recovery milestone telemetry
    milestones_achieved INT NOT NULL DEFAULT 0,            -- 7d/14d/30d/etc reached
    recovery_velocity_pct_per_day NUMERIC(5, 2),          -- How fast confidence recovering

    -- System health flags
    is_degraded BOOLEAN DEFAULT FALSE,                     -- True if invalidation_failures > threshold
    alert_level VARCHAR(30) CHECK (
        alert_level IS NULL OR alert_level IN ('INFO', 'WARNING', 'CRITICAL')
    ),

    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_index_name ON governance_telemetry(index_name);
CREATE INDEX IF NOT EXISTS idx_telemetry_measurement_window ON governance_telemetry(measurement_window DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_is_degraded ON governance_telemetry(is_degraded) WHERE is_degraded = TRUE;

-- ============================================================
-- 3. AUDIT SNAPSHOTS (Point-in-Time Trust State)
-- ============================================================
-- Periodic captures of complete governance state
-- Enables audit replay: "what was the trust score at time T?"

CREATE TABLE IF NOT EXISTS governance_audit_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,
    snapshot_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Complete governance state at snapshot time
    governance_state VARCHAR(50) NOT NULL,                 -- PROPOSED, APPROVED, CONDITIONAL, REJECTED, QUARANTINED
    approval_state_reason TEXT,                            -- Why in this state (last action taken)
    last_approver_id VARCHAR(255),
    last_approval_timestamp TIMESTAMP WITH TIME ZONE,
    approval_expires_at TIMESTAMP WITH TIME ZONE,

    -- Confidence component breakdown
    base_confidence NUMERIC(3, 2),
    approval_factor NUMERIC(3, 2),                         -- 1.0 (APPROVED), 0.5 (unreviewed), 0.0 (REJECTED)
    drift_penalty NUMERIC(3, 2),
    temporal_decay NUMERIC(3, 2),
    recovery_factor NUMERIC(3, 2),
    oscillation_multiplier NUMERIC(3, 2),

    -- Effective confidence after all multipliers
    effective_confidence NUMERIC(3, 2),
    confidence_band VARCHAR(20),                           -- UNRELIABLE, CAUTION, RELIABLE, TRUSTED
    governance_cap NUMERIC(3, 2),
    is_capped BOOLEAN,

    -- Recovery state
    recovery_score NUMERIC(3, 2),
    consecutive_stable_days INT,
    days_until_next_milestone INT,

    -- Drift state
    drift_detected BOOLEAN,
    drift_severity VARCHAR(30),
    drift_confidence_penalty NUMERIC(3, 2),

    -- Reanalysis state
    reanalysis_pending BOOLEAN,
    reanalysis_priority_tier VARCHAR(30),
    reanalysis_cooldown_until TIMESTAMP WITH TIME ZONE,

    -- Sampling audit
    was_recently_sampled BOOLEAN,
    last_sample_outcome VARCHAR(50),                       -- APPROVED, NEEDS_REANALYSIS, DRIFT_DETECTED, DISCARDED

    -- Version tracking
    expected_version VARCHAR(64),                          -- Snapshot of version hash at this time
    mutation_count_since_approval INT,                     -- # of mutations since approval

    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_snapshots_index_name ON governance_audit_snapshots(index_name);
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_snapshot_timestamp ON governance_audit_snapshots(snapshot_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_governance_state ON governance_audit_snapshots(governance_state);

-- ============================================================
-- 4. GOVERNANCE HISTORY VIEW (Audit Replay Support)
-- ============================================================
-- Materialized view for fast time-travel queries
-- Query: "What was the confidence score for index X from T1 to T2?"

CREATE OR REPLACE VIEW governance_history_timeline AS
SELECT
    index_name,
    recorded_at AS event_time,
    'mutation' AS event_source,
    event_type,
    action_intent,
    from_state,
    to_state,
    effective_confidence,
    confidence_band,
    governance_cap,
    api_response_code,
    api_error_code,
    client_mutation_duration_ms,
    api_response_duration_ms,
    reviewer_id,
    blocking_reason
FROM governance_mutation_journal
UNION ALL
SELECT
    index_name,
    snapshot_timestamp AS event_time,
    'snapshot' AS event_source,
    NULL::VARCHAR AS event_type,
    NULL::VARCHAR AS action_intent,
    NULL::VARCHAR AS from_state,
    governance_state AS to_state,
    effective_confidence,
    confidence_band,
    governance_cap,
    NULL::INT AS api_response_code,
    NULL::VARCHAR AS api_error_code,
    NULL::INT AS client_mutation_duration_ms,
    NULL::INT AS api_response_duration_ms,
    last_approver_id AS reviewer_id,
    NULL::VARCHAR AS blocking_reason
FROM governance_audit_snapshots
ORDER BY index_name, event_time DESC;

-- ============================================================
-- 5. GOVERNANCE HEALTH SUMMARY VIEW
-- ============================================================
-- Real-time operational health indicators

CREATE OR REPLACE VIEW governance_health_summary AS
WITH recent_telemetry AS (
    SELECT
        index_name,
        measurement_window,
        mutation_attempts,
        mutation_failures,
        version_collisions,
        invalidation_failures,
        operations_abandoned,
        is_degraded,
        alert_level,
        ROW_NUMBER() OVER (PARTITION BY index_name ORDER BY measurement_window DESC) AS rn
    FROM governance_telemetry
    WHERE measurement_window > NOW() - INTERVAL '24 hours'
)
SELECT
    (SELECT COUNT(DISTINCT index_name) FROM governance_mutation_journal WHERE recorded_at > NOW() - INTERVAL '24 hours') AS indexes_with_mutations_24h,
    (SELECT COUNT(*) FROM governance_mutation_journal WHERE event_type = 'GOVERNANCE_VERSION_COLLISION' AND recorded_at > NOW() - INTERVAL '24 hours') AS version_collisions_24h,
    (SELECT COUNT(*) FROM governance_mutation_journal WHERE event_type = 'GOVERNANCE_CACHE_DESYNC' AND recorded_at > NOW() - INTERVAL '24 hours') AS invalidation_failures_24h,
    (SELECT COUNT(*) FROM governance_mutation_journal WHERE event_type = 'GOVERNANCE_MUTATION_ABANDONED' AND recorded_at > NOW() - INTERVAL '24 hours') AS operations_abandoned_24h,
    (SELECT COUNT(DISTINCT index_name) FROM governance_telemetry WHERE is_degraded = TRUE AND measurement_window > NOW() - INTERVAL '24 hours') AS degraded_indexes,
    (SELECT AVG(post_refresh_success_rate) FROM governance_telemetry WHERE post_refresh_success_rate IS NOT NULL AND measurement_window > NOW() - INTERVAL '24 hours') AS avg_post_refresh_success_rate,
    (SELECT AVG(abandon_rate_pct) FROM governance_telemetry WHERE abandon_rate_pct IS NOT NULL AND measurement_window > NOW() - INTERVAL '24 hours') AS avg_operator_abandon_rate;

-- ============================================================
-- 6. OPERATOR SESSION TRACKING
-- ============================================================
-- Track operator activity patterns for audit and coaching

CREATE TABLE IF NOT EXISTS operator_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewer_id VARCHAR(255) NOT NULL,

    -- Session lifecycle
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    session_duration_minutes INT,

    -- Activity during session
    mutation_attempts INT NOT NULL DEFAULT 0,
    mutation_successes INT NOT NULL DEFAULT 0,
    mutations_abandoned INT NOT NULL DEFAULT 0,

    -- Error encounters
    version_collisions_encountered INT NOT NULL DEFAULT 0,
    refresh_retries_performed INT NOT NULL DEFAULT 0,

    -- Session context
    indexes_reviewed VARCHAR(255)[] DEFAULT '{}',  -- Array of index names reviewed in session
    most_common_action VARCHAR(50),                 -- Most frequent action in session

    -- Operator feedback (if captured)
    operator_notes TEXT,

    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_reviewer_id ON operator_sessions(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_started_at ON operator_sessions(started_at DESC);

-- ============================================================
-- 7. GOVERNANCE EVENTS VIEW (High-Level Event Stream)
-- ============================================================
-- Simplified event stream for real-time monitoring/alerting

CREATE OR REPLACE VIEW governance_events_stream AS
SELECT
    event_id,
    index_name,
    event_type,
    from_state,
    to_state,
    reviewer_id,
    api_response_code,
    api_error_code,
    blocking_reason,
    recorded_at,
    CASE
        WHEN event_type LIKE 'GOVERNANCE_FAILURE%' OR api_response_code >= 400 THEN 'ERROR'
        WHEN event_type LIKE '%COLLISION%' OR event_type LIKE '%DESYNC%' THEN 'COLLISION'
        WHEN event_type = 'GOVERNANCE_MUTATION_SUCCESS' THEN 'SUCCESS'
        ELSE 'INFO'
    END AS event_severity
FROM governance_mutation_journal
WHERE recorded_at > NOW() - INTERVAL '7 days'
ORDER BY recorded_at DESC;

-- ============================================================
-- PHASE 6 COMPLETE: Governance Observability Foundation
-- ============================================================
-- System now has:
-- ✅ Immutable event journaling (governance_mutation_journal)
-- ✅ Telemetry aggregation (governance_telemetry)
-- ✅ Point-in-time audit snapshots (governance_audit_snapshots)
-- ✅ Time-travel query support (governance_history_timeline view)
-- ✅ Real-time health indicators (governance_health_summary view)
-- ✅ Operator session tracking (operator_sessions)
-- ✅ Event streaming (governance_events_stream view)
--
-- Ready for Phase 6 services layer:
-- - governance-telemetry-service.ts (record events, aggregate metrics)
-- - governance-audit-service.ts (replay history, reconstruct state)
-- - operator-session-service.ts (track sessions, analyze patterns)
