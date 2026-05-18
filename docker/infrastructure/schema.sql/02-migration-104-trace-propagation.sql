-- ============================================
-- Migration 104: Phase 6.1.5 Trace Propagation Fabric
-- ============================================
-- Adds distributed tracing schema for unbroken causal linkage across async boundaries
-- Replaces binary is_divergent with multi-tier coherence classification
-- Introduces execution context isolation for simulation/sandbox safety
-- Implements STATE_VERIFIED terminal state assertion

BEGIN;

-- ============================================
-- 1. GOVERNANCE MUTATION JOURNAL EXTENSION
-- ============================================
-- Extends Phase 6.1 mutation_journal with W3C Trace Context fields

ALTER TABLE governance_mutation_journal
ADD COLUMN IF NOT EXISTS trace_id VARCHAR(32) NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN IF NOT EXISTS span_id VARCHAR(16) NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN IF NOT EXISTS parent_span_id VARCHAR(16) NULL,
ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64) NOT NULL DEFAULT ('corr_' || EXTRACT(EPOCH FROM NOW())::TEXT || '_' || gen_random_uuid()::text),
ADD COLUMN IF NOT EXISTS execution_context VARCHAR(30) NOT NULL DEFAULT 'PRODUCTION' CHECK (execution_context IN ('PRODUCTION', 'SANDBOX', 'SIMULATION', 'REPLAY', 'TESTING')),
ADD COLUMN IF NOT EXISTS metadata_payload JSONB NOT NULL DEFAULT '{}';

-- Create indexes for trace traversal
CREATE INDEX IF NOT EXISTS idx_gmj_trace_id ON governance_mutation_journal(trace_id);
CREATE INDEX IF NOT EXISTS idx_gmj_trace_parent ON governance_mutation_journal(trace_id, parent_span_id);
CREATE INDEX IF NOT EXISTS idx_gmj_span_id ON governance_mutation_journal(span_id);
CREATE INDEX IF NOT EXISTS idx_gmj_correlation_id ON governance_mutation_journal(correlation_id);
CREATE INDEX IF NOT EXISTS idx_gmj_execution_context ON governance_mutation_journal(execution_context);

-- ============================================
-- 2. MUTATION LIFECYCLE EVENTS (NEW TABLE)
-- ============================================
-- Tracks 10-stage progression with trace context linkage
-- Used by Phase 6.2 automated remediation for state machine validation

CREATE TABLE IF NOT EXISTS mutation_lifecycle_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id VARCHAR(32) NOT NULL,
    span_id VARCHAR(16) NOT NULL,
    parent_span_id VARCHAR(16) NULL,
    correlation_id VARCHAR(64) NOT NULL,

    -- 10-stage progression
    lifecycle_state VARCHAR(50) NOT NULL CHECK (lifecycle_state IN (
        'INTENT_RECEIVED',
        'MUTATION_DISPATCHED',
        'API_ACCEPTED',
        'STATE_PERSISTED',
        'AUDIT_SNAPSHOTTED',
        'QUERY_INVALIDATED',
        'CACHE_REFRESH_REQUESTED',
        'QUERY_REFETCHED',
        'UI_RECONCILED',
        'STATE_VERIFIED'
    )),
    previous_state VARCHAR(50) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'timeout', 'cancelled')),

    -- Timing
    duration_in_state_ms INTEGER NOT NULL DEFAULT 0,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Error context
    error_code VARCHAR(100) NULL,
    error_message TEXT NULL,

    -- Execution isolation
    execution_context VARCHAR(30) NOT NULL DEFAULT 'PRODUCTION',

    -- Custom metadata
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mle_trace_id ON mutation_lifecycle_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_mle_correlation_id ON mutation_lifecycle_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_mle_lifecycle_state ON mutation_lifecycle_events(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_mle_recorded_at ON mutation_lifecycle_events(recorded_at DESC);
-- Indexes for Phase 6.1.5A.1.1 validation layer
CREATE INDEX IF NOT EXISTS idx_mle_trace_recorded ON mutation_lifecycle_events(trace_id, recorded_at ASC);
CREATE INDEX IF NOT EXISTS idx_mle_parent_span ON mutation_lifecycle_events(parent_span_id);
CREATE INDEX IF NOT EXISTS idx_mle_trace_status ON mutation_lifecycle_events(trace_id, status);

-- ============================================
-- 3. CACHE COHERENCE TELEMETRY EXTENSION
-- ============================================
-- Replaces binary is_divergent with multi-tier coherence classification
-- Adds state verification hashes for terminal state assertion

ALTER TABLE cache_coherence_telemetry
ADD COLUMN IF NOT EXISTS trace_id VARCHAR(32) NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN IF NOT EXISTS coherence_tier VARCHAR(20) NOT NULL DEFAULT 'NOMINAL' CHECK (coherence_tier IN ('NOMINAL', 'DEGRADED', 'STALE', 'SEVERE')),
ADD COLUMN IF NOT EXISTS target_state_hash VARCHAR(64) NULL,
ADD COLUMN IF NOT EXISTS actual_state_hash VARCHAR(64) NULL,
ADD COLUMN IF NOT EXISTS stale_render_duration_ms INTEGER NULL;

-- Drop old is_divergent column if exists (backward compat)
ALTER TABLE cache_coherence_telemetry
DROP COLUMN IF EXISTS is_divergent;

-- Create indexes for coherence queries
CREATE INDEX IF NOT EXISTS idx_cct_trace_id ON cache_coherence_telemetry(trace_id);
CREATE INDEX IF NOT EXISTS idx_cct_coherence_tier ON cache_coherence_telemetry(coherence_tier);
CREATE INDEX IF NOT EXISTS idx_cct_total_divergence ON cache_coherence_telemetry(total_divergence_window_ms);

-- ============================================
-- 4. GOVERNANCE SIMULATION JOURNAL (NEW TABLE)
-- ============================================
-- Complete isolation of simulation/sandbox traces from production metrics
-- Prevents test data from corrupting automation stability statistics

CREATE TABLE IF NOT EXISTS governance_simulation_journal (
    simulation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id VARCHAR(32) NOT NULL,
    span_id VARCHAR(16) NOT NULL,
    parent_span_id VARCHAR(16) NULL,
    correlation_id VARCHAR(64) NOT NULL,

    -- Simulation metadata
    execution_context VARCHAR(30) NOT NULL CHECK (execution_context IN ('SANDBOX', 'SIMULATION', 'TESTING')),
    lifecycle_state VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'success',

    -- Timing
    duration_in_state_ms INTEGER NOT NULL DEFAULT 0,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Error context (for failed simulations)
    error_code VARCHAR(100) NULL,
    error_message TEXT NULL,

    -- Custom metadata
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_gsj_trace_id ON governance_simulation_journal(trace_id);
CREATE INDEX IF NOT EXISTS idx_gsj_correlation_id ON governance_simulation_journal(correlation_id);
CREATE INDEX IF NOT EXISTS idx_gsj_execution_context ON governance_simulation_journal(execution_context);
CREATE INDEX IF NOT EXISTS idx_gsj_recorded_at ON governance_simulation_journal(recorded_at DESC);

-- ============================================
-- 5. BACKFILL EXISTING ROWS (DETERMINISTIC)
-- ============================================
-- Generates synthetic but deterministic trace IDs for historical data
-- Uses 'LEGACY_UNTRACED' marker in metadata for audit trail clarity

UPDATE governance_mutation_journal
SET
    trace_id = CASE
        WHEN trace_id IS NULL OR trace_id = ''
        THEN 'trc_backfill_' || EXTRACT(EPOCH FROM created_at)::TEXT || '_' || id::TEXT
        ELSE trace_id
    END,
    span_id = CASE
        WHEN span_id IS NULL OR span_id = ''
        THEN 'spn_backfill_' || EXTRACT(EPOCH FROM created_at)::TEXT
        ELSE span_id
    END,
    correlation_id = CASE
        WHEN correlation_id IS NULL OR correlation_id = ''
        THEN 'corr_' || EXTRACT(EPOCH FROM created_at)::TEXT || '_legacy'
        ELSE correlation_id
    END,
    metadata_payload = jsonb_set(
        metadata_payload,
        '{backfill_source}',
        '"migration_104"'::jsonb
    )
WHERE trace_id IS NULL OR trace_id = '';

-- ============================================
-- 6. TRACE STITCHING VIEWS (GLOBAL CORRELATION)
-- ============================================
-- Enable cross-index correlation views for Phase 6.2 automated remediation

CREATE VIEW IF NOT EXISTS v_correlation_timeline AS
SELECT
    correlation_id,
    MIN(recorded_at) as chain_start_at,
    MAX(recorded_at) as chain_end_at,
    (EXTRACT(EPOCH FROM MAX(recorded_at)) - EXTRACT(EPOCH FROM MIN(recorded_at))) * 1000 as chain_duration_ms,
    COUNT(DISTINCT trace_id) as trace_count,
    COUNT(*) as event_count,
    ARRAY_AGG(DISTINCT lifecycle_state) as states_observed
FROM mutation_lifecycle_events
GROUP BY correlation_id;

CREATE VIEW IF NOT EXISTS v_coherence_by_tier AS
SELECT
    coherence_tier,
    COUNT(*) as event_count,
    ROUND(AVG(total_divergence_window_ms), 2) as avg_divergence_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_divergence_window_ms), 2) as p95_divergence_ms,
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_divergence_window_ms), 2) as p99_divergence_ms,
    COUNT(CASE WHEN actual_state_hash != target_state_hash THEN 1 END) as state_verification_failures
FROM cache_coherence_telemetry
WHERE execution_context = 'PRODUCTION'
GROUP BY coherence_tier;

CREATE VIEW IF NOT EXISTS v_lifecycle_latency_by_state AS
SELECT
    lifecycle_state,
    COUNT(*) as transition_count,
    ROUND(AVG(duration_in_state_ms), 2) as avg_duration_ms,
    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_in_state_ms), 2) as p50_duration_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_in_state_ms), 2) as p95_duration_ms,
    COUNT(CASE WHEN status != 'success' THEN 1 END) as error_count
FROM mutation_lifecycle_events
WHERE execution_context = 'PRODUCTION'
GROUP BY lifecycle_state;

-- ============================================
-- 8. TRACE COMPLETENESS VALIDATION VIEW
-- ============================================
-- Phase 6.1.5A.1.1 validation layer support
-- Tracks completeness metrics for all recent traces

CREATE VIEW IF NOT EXISTS v_trace_completeness AS
SELECT
    trace_id,
    COUNT(DISTINCT lifecycle_state) as observed_stage_count,
    CASE WHEN COUNT(DISTINCT lifecycle_state) = 10 THEN 'COMPLETE' ELSE 'INCOMPLETE' END as completeness_status,
    ROUND(100.0 * COUNT(DISTINCT lifecycle_state) / 10, 1) as stage_coverage_pct,
    COUNT(DISTINCT span_id) as span_count,
    COUNT(CASE WHEN parent_span_id IS NULL THEN 1 END) as root_span_count,
    COUNT(DISTINCT CASE WHEN status IN ('error', 'timeout', 'cancelled') THEN span_id END) as error_span_count,
    MIN(recorded_at) as trace_start_at,
    MAX(recorded_at) as trace_end_at,
    (EXTRACT(EPOCH FROM MAX(recorded_at)) - EXTRACT(EPOCH FROM MIN(recorded_at))) * 1000 as total_duration_ms
FROM mutation_lifecycle_events
WHERE execution_context = 'PRODUCTION'
GROUP BY trace_id;

-- ============================================
-- 7. PRODUCTION READINESS FLAGS
-- ============================================
-- Schema is now ready for Phase 6.1.5A.1 (Trace Context Runtime Integration)
-- Next: Deploy GovernanceCausalityEngine with AsyncLocalStorage

COMMIT;
