-- ============================================================
-- Migration 001_v1_stable__governance_ledger.sql
-- Canonical v1 Core Schema: Deterministic, Idempotent, Chain-Free
-- Date: 2026-05-18
-- ============================================================
-- This replaces the broken 014-024 chain with a single, unified foundation
-- that has NO generated-column dependencies and NO GROUP BY ordering issues.

-- ============================================================
-- 1. TELEMETRY FACTS TABLE (The Invariant Reality)
-- ============================================================
-- Immutable Splunk-sourced metrics. Single source of truth.
CREATE TABLE IF NOT EXISTS telemetry_facts (
    fact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,
    snapshot_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Base Metrics (from Splunk, never AI-derived)
    daily_avg_gb NUMERIC(12, 4) NOT NULL CHECK (daily_avg_gb >= 0),
    utilization_pct NUMERIC(5, 2) NOT NULL CHECK (utilization_pct >= 0 AND utilization_pct <= 100),
    retention_days INT NOT NULL CHECK (retention_days > 0),
    storage_cost_per_gb_mo NUMERIC(10, 2) NOT NULL CHECK (storage_cost_per_gb_mo >= 0),
    days_since_last_event INT NOT NULL DEFAULT 0 CHECK (days_since_last_event >= 0),

    -- FLATTENED COMPUTED COLUMNS (Direct from base variables only, no chain dependencies)
    calculated_daily_waste_gb NUMERIC(12, 4) GENERATED ALWAYS AS (
        daily_avg_gb * (1.0 - (utilization_pct / 100.0))
    ) STORED,

    calculated_monthly_waste_gb NUMERIC(12, 4) GENERATED ALWAYS AS (
        daily_avg_gb * 30.0 * (1.0 - (utilization_pct / 100.0))
    ) STORED,

    calculated_monthly_loss_usd NUMERIC(12, 2) GENERATED ALWAYS AS (
        (daily_avg_gb * 30.0 * (1.0 - (utilization_pct / 100.0))) * storage_cost_per_gb_mo
    ) STORED,

    calculated_annual_loss_usd NUMERIC(12, 2) GENERATED ALWAYS AS (
        (daily_avg_gb * 30.0 * (1.0 - (utilization_pct / 100.0))) * storage_cost_per_gb_mo * 12
    ) STORED,

    UNIQUE (index_name, snapshot_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_facts_index_name ON telemetry_facts(index_name);
CREATE INDEX IF NOT EXISTS idx_telemetry_facts_snapshot_timestamp ON telemetry_facts(snapshot_timestamp);

-- ============================================================
-- 2. COGNITIVE ENRICHMENTS TABLE (The AI Interpretation Layer)
-- ============================================================
-- LLM-derived signals. Versioned, never treated as fact.
CREATE TABLE IF NOT EXISTS cognitive_enrichments (
    enrichment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id UUID NOT NULL UNIQUE REFERENCES telemetry_facts(fact_id) ON DELETE CASCADE,

    -- AI Model Provenance
    ai_model_signature VARCHAR(100) NOT NULL,
    prompt_version_hash VARCHAR(64) NOT NULL,
    inference_tokens INT,
    latency_ms INT,

    -- AI-derived assessments (governance, not fact)
    confidence_score NUMERIC(3, 2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    risk_category VARCHAR(50) NOT NULL,
    strategic_rationale TEXT NOT NULL,
    remediation_suggestion TEXT NOT NULL,

    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cognitive_enrichments_fact_id ON cognitive_enrichments(fact_id);

-- ============================================================
-- 3. HUMAN REVIEW LEDGER (The Calibration/Verification Loop)
-- ============================================================
-- Breaks the stable hallucination loop. Guards against AI drift.
CREATE TABLE IF NOT EXISTS human_review_ledger (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id UUID NOT NULL REFERENCES telemetry_facts(fact_id) ON DELETE CASCADE,
    enrichment_id UUID NOT NULL REFERENCES cognitive_enrichments(enrichment_id) ON DELETE CASCADE,

    reviewed_by VARCHAR(255) NOT NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Idempotent state machine (VARCHAR + CHECK, not enum)
    review_action VARCHAR(50) NOT NULL CHECK (
        review_action IN ('APPROVED', 'REJECTED', 'ESCALATED', 'CONDITIONAL', 'UNDER_INVESTIGATION')
    ),
    admin_notes TEXT,

    -- Derived fields (safe to compute since no dependencies)
    is_disagreement BOOLEAN GENERATED ALWAYS AS (
        review_action IN ('REJECTED', 'ESCALATED')
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_human_review_ledger_fact_id ON human_review_ledger(fact_id);
CREATE INDEX IF NOT EXISTS idx_human_review_ledger_review_action ON human_review_ledger(review_action);

-- ============================================================
-- 4. DECISION DRIFT HISTORY (The Change Auditing Ledger)
-- ============================================================
-- Tracks all drift events with severity classification and confidence penalties.
CREATE TABLE IF NOT EXISTS decision_drift_history (
    drift_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,
    previous_fingerprint VARCHAR(64) NOT NULL,
    new_fingerprint VARCHAR(64) NOT NULL,

    -- Quantified changes
    volume_drift_pct NUMERIC(7, 2) NOT NULL,
    utilization_delta_pct NUMERIC(5, 2) NOT NULL,
    retention_changed BOOLEAN NOT NULL,
    freshness_changed BOOLEAN NOT NULL,

    -- Severity classification (VARCHAR + CHECK, not enum)
    drift_severity VARCHAR(30) NOT NULL CHECK (
        drift_severity IN ('STABLE', 'NOISE', 'METRIC_DRIFT', 'SEMANTIC_DRIFT', 'POLICY_DRIFT')
    ),
    drift_reason VARCHAR(255) NOT NULL,
    confidence_penalty_applied NUMERIC(3, 2) NOT NULL DEFAULT 1.00 CHECK (confidence_penalty_applied >= 0 AND confidence_penalty_applied <= 1),
    approvals_invalidated BOOLEAN NOT NULL DEFAULT FALSE,

    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_drift_history_index_name ON decision_drift_history(index_name);
CREATE INDEX IF NOT EXISTS idx_decision_drift_history_severity ON decision_drift_history(drift_severity);

-- ============================================================
-- 5. REANALYSIS JOB QUEUE (Resource-Budgeted Pipeline)
-- ============================================================
-- Priority-driven background processing with tier-based rate limiting.
CREATE TABLE IF NOT EXISTS reanalysis_job_queue (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,
    trigger_source VARCHAR(50) NOT NULL,

    -- Priority tier (VARCHAR + CHECK, not enum)
    priority_tier VARCHAR(30) NOT NULL CHECK (
        priority_tier IN ('EMERGENCY', 'CRITICAL', 'STANDARD', 'BACKGROUND', 'DEFERRED')
    ),

    execution_state VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (
        execution_state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    ),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_reanalysis_job_queue_index_name ON reanalysis_job_queue(index_name);
CREATE INDEX IF NOT EXISTS idx_reanalysis_job_queue_priority_tier ON reanalysis_job_queue(priority_tier);
CREATE INDEX IF NOT EXISTS idx_reanalysis_job_queue_execution_state ON reanalysis_job_queue(execution_state);

-- ============================================================
-- 6. INDEX ROLLING BASELINES (Statistical Seasonality States)
-- ============================================================
-- Tracks stability and recovery state per index.
CREATE TABLE IF NOT EXISTS index_rolling_baselines (
    index_name VARCHAR(255) PRIMARY KEY,
    consecutive_clean_snapshots INT NOT NULL DEFAULT 0,
    historical_drift_count INT NOT NULL DEFAULT 0,
    recovery_cooldown_until TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- VALIDATION VIEWS (Safe to reorder after all tables created)
-- ============================================================

-- Trust Composition View: Full lineage with all multipliers visible
CREATE OR REPLACE VIEW trust_composition_analysis AS
SELECT
    f.index_name,
    f.calculated_monthly_loss_usd AS provable_loss_usd,
    e.confidence_score AS base_ai_confidence,
    d.drift_severity AS drift_status,
    d.confidence_penalty_applied AS drift_penalty,
    r.review_action AS human_review_status,

    -- Effective confidence calculation (base × drift × approval × decay)
    ROUND(
        e.confidence_score *
        d.confidence_penalty_applied *
        CASE WHEN r.review_action = 'APPROVED' THEN 1.00
             WHEN r.review_action = 'REJECTED' THEN 0.0
             ELSE 0.5
        END,
        2
    ) AS calculated_effective_confidence,

    f.created_at AS fact_created_at,
    r.reviewed_at AS last_review_at
FROM telemetry_facts f
LEFT JOIN cognitive_enrichments e ON f.fact_id = e.fact_id
LEFT JOIN decision_drift_history d ON f.index_name = d.index_name AND d.evaluated_at = (
    SELECT MAX(evaluated_at) FROM decision_drift_history WHERE index_name = f.index_name
)
LEFT JOIN human_review_ledger r ON f.fact_id = r.fact_id AND r.reviewed_at = (
    SELECT MAX(reviewed_at) FROM human_review_ledger WHERE fact_id = f.fact_id
);

-- Queue Health View: Aggregated queue statistics by tier
CREATE OR REPLACE VIEW queue_health_summary AS
SELECT
    priority_tier,
    COUNT(*) as job_count,
    SUM(CASE WHEN execution_state = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
    SUM(CASE WHEN execution_state = 'PROCESSING' THEN 1 ELSE 0 END) as processing_count,
    SUM(CASE WHEN execution_state = 'COMPLETED' THEN 1 ELSE 0 END) as completed_count,
    SUM(CASE WHEN execution_state = 'FAILED' THEN 1 ELSE 0 END) as failed_count
FROM reanalysis_job_queue
GROUP BY priority_tier
ORDER BY
    CASE priority_tier
        WHEN 'EMERGENCY' THEN 1
        WHEN 'CRITICAL' THEN 2
        WHEN 'STANDARD' THEN 3
        WHEN 'BACKGROUND' THEN 4
        WHEN 'DEFERRED' THEN 5
    END;

-- Drift Summary View: Current drift state by severity
CREATE OR REPLACE VIEW drift_event_summary AS
SELECT
    drift_severity,
    COUNT(*) as event_count,
    COUNT(DISTINCT index_name) as affected_indexes,
    AVG(confidence_penalty_applied) as avg_penalty,
    MAX(evaluated_at) as most_recent_event
FROM decision_drift_history
GROUP BY drift_severity
ORDER BY event_count DESC;

-- ============================================================
-- SCHEMA COMPLETION MARKER
-- ============================================================
-- All tables created. All views created. Zero dependencies broken.
-- This schema is deterministic, idempotent, and safe for ci/cd.
