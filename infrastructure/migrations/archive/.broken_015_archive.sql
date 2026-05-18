-- ============================================
-- Migration 015: Immutable Telemetry Ledger
-- Date: 2026-05-18
-- Description: Schema-enforced separation of deterministic facts from AI interpretation
-- ============================================

-- Core immutable facts: Deterministic calculations only
CREATE TABLE IF NOT EXISTS telemetry_facts (
    fact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    index_name VARCHAR(255) NOT NULL,
    sourcetype VARCHAR(255),
    snapshot_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- HARD, PROVABLE METRICS FROM SPLUNK (never AI-generated)
    daily_avg_gb NUMERIC(14, 4) NOT NULL CHECK (daily_avg_gb >= 0),
    utilization_pct NUMERIC(5, 2) NOT NULL CHECK (utilization_pct >= 0 AND utilization_pct <= 100),
    retention_days INT NOT NULL CHECK (retention_days > 0),
    search_count_30d INT NOT NULL DEFAULT 0 CHECK (search_count_30d >= 0),
    days_since_last_event INT NOT NULL DEFAULT 0 CHECK (days_since_last_event >= 0),

    -- HARDCODED CONFIGURATION (immutable during run)
    storage_cost_per_gb_mo NUMERIC(10, 4) NOT NULL CHECK (storage_cost_per_gb_mo >= 0),

    -- COMPUTED COLUMNS: Deterministic math locked at the schema level
    -- These cannot be overwritten. They are always correct.
    daily_waste_gb NUMERIC(14, 4) GENERATED ALWAYS AS (
        CASE
            WHEN utilization_pct = 0 THEN daily_avg_gb
            ELSE ROUND(daily_avg_gb * (1.0 - (utilization_pct / 100.0))::numeric, 4)
        END
    ) STORED,

    monthly_waste_gb NUMERIC(14, 4) GENERATED ALWAYS AS (
        CASE
            WHEN utilization_pct = 0 THEN ROUND((daily_avg_gb * 30)::numeric, 4)
            ELSE ROUND((daily_avg_gb * (1.0 - (utilization_pct / 100.0)) * 30)::numeric, 4)
        END
    ) STORED,

    monthly_waste_usd NUMERIC(14, 2) GENERATED ALWAYS AS (
        CASE
            WHEN utilization_pct = 0 THEN ROUND((daily_avg_gb * 30 * storage_cost_per_gb_mo)::numeric, 2)
            ELSE ROUND((daily_avg_gb * (1.0 - (utilization_pct / 100.0)) * 30 * storage_cost_per_gb_mo)::numeric, 2)
        END
    ) STORED,

    annual_waste_usd NUMERIC(14, 2) GENERATED ALWAYS AS (
        CASE
            WHEN utilization_pct = 0 THEN ROUND((daily_avg_gb * 30 * storage_cost_per_gb_mo * 12)::numeric, 2)
            ELSE ROUND((daily_avg_gb * (1.0 - (utilization_pct / 100.0)) * 30 * storage_cost_per_gb_mo * 12)::numeric, 2)
        END
    ) STORED,

    UNIQUE (snapshot_id, index_name, sourcetype)
);

-- Cognitive enrichment: AI interpretation layer (read-only from business logic)
CREATE TABLE IF NOT EXISTS cognitive_enrichments (
    enrichment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id UUID NOT NULL REFERENCES telemetry_facts(fact_id) ON DELETE CASCADE,
    snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,

    -- AI Model Provenance
    ai_model_name VARCHAR(100) NOT NULL,           -- e.g., 'qwen2.5:14b'
    ai_model_version VARCHAR(50) NOT NULL,
    prompt_hash VARCHAR(64) NOT NULL,
    fingerprint_version INT NOT NULL,

    -- Pure AI inference (governance interpretation, NOT facts)
    confidence_score NUMERIC(3, 2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    risk_category VARCHAR(50) NOT NULL,            -- 'HIGH_GROWTH', 'STALE', 'OVER_PROVISIONED', etc.
    strategic_rationale TEXT NOT NULL,             -- The "why" explanation (not numbers)
    remediation_suggestion TEXT NOT NULL,          -- Action recommendation

    -- Stability tracking (for detecting stable hallucinations)
    inference_tokens INT,
    latency_ms INT,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (fact_id)
);

-- Human Review Ledger: Governance calibration (breaks stable hallucination loop)
CREATE TABLE IF NOT EXISTS human_review_ledger (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id UUID NOT NULL REFERENCES telemetry_facts(fact_id) ON DELETE CASCADE,
    enrichment_id UUID REFERENCES cognitive_enrichments(enrichment_id) ON DELETE SET NULL,

    -- Review state machine
    review_status VARCHAR(50) NOT NULL DEFAULT 'UNREVIEWED', -- UNREVIEWED, APPROVED, REJECTED
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP WITH TIME ZONE,

    -- Calibration vector (breaks the reuse-amplification loop)
    -- UNREVIEWED: AI confidence capped at 50%
    -- APPROVED: AI confidence can scale to 100%
    -- REJECTED: Fingerprint blacklisted, forces re-analysis
    calibration_vector NUMERIC(3, 2) DEFAULT 0.5 CHECK (calibration_vector >= 0 AND calibration_vector <= 1),

    -- Justification for human decision
    review_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Governance metadata: Tracks which layer owns which decision
CREATE TABLE IF NOT EXISTS governance_lineage (
    lineage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id UUID NOT NULL REFERENCES telemetry_facts(fact_id) ON DELETE CASCADE,

    -- Data provenance: Where did these facts come from?
    source_system VARCHAR(100) NOT NULL,           -- 'SPLUNK', 'AGGREGATION_SCRIPT'
    source_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Computation provenance: Who/what calculated this?
    computed_by VARCHAR(100) NOT NULL,             -- 'DETERMINISTIC_SCRIPT_V3', 'AI_MODEL'
    computation_hash VARCHAR(64),                  -- Hash of the logic that generated it

    -- Reuse provenance: Was this inherited from a prior snapshot?
    reused_from_fact_id UUID REFERENCES telemetry_facts(fact_id) ON DELETE SET NULL,
    reuse_confidence NUMERIC(3, 2),                -- How confident are we in the reuse?

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_telemetry_facts_snapshot ON telemetry_facts(snapshot_id);
CREATE INDEX idx_telemetry_facts_index_name ON telemetry_facts(index_name);
CREATE INDEX idx_cognitive_enrichments_fact ON cognitive_enrichments(fact_id);
CREATE INDEX idx_cognitive_enrichments_model ON cognitive_enrichments(ai_model_name, ai_model_version);
CREATE INDEX idx_human_review_fact ON human_review_ledger(fact_id);
CREATE INDEX idx_human_review_status ON human_review_ledger(review_status);
CREATE INDEX idx_governance_lineage_fact ON governance_lineage(fact_id);
CREATE INDEX idx_governance_lineage_reuse ON governance_lineage(reused_from_fact_id);
