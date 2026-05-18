-- ============================================
-- Migration 016: Trust Decay, Expiry, and Disagreement Tracking
-- Date: 2026-05-18
-- Description: Complete governance lifecycle management - time decay, approval expiry, model health
-- ============================================

-- Extend human_review_ledger with temporal governance controls
ALTER TABLE human_review_ledger
ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS (
    reviewed_at + INTERVAL '90 days'
) STORED,
ADD COLUMN is_disagreement BOOLEAN GENERATED ALWAYS AS (
    review_status IN ('REJECTED')
) STORED,
ADD COLUMN original_confidence NUMERIC(3, 2),
ADD COLUMN days_since_review INT GENERATED ALWAYS AS (
    EXTRACT(DAY FROM (NOW() - reviewed_at))::INT
) STORED;

-- Create model health tracking table (disagreement rate + drift detection)
CREATE TABLE IF NOT EXISTS model_health_ledger (
    ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL,

    -- Disagreement metrics (model trust score)
    total_reviews_30d INT NOT NULL DEFAULT 0,
    total_rejections_30d INT NOT NULL DEFAULT 0,
    model_trust_score NUMERIC(3, 2) GENERATED ALWAYS AS (
        CASE
            WHEN total_reviews_30d = 0 THEN 1.0
            ELSE ROUND((1.0 - (total_rejections_30d::NUMERIC / total_reviews_30d))::NUMERIC, 2)
        END
    ) STORED,

    -- Drift detection signals
    fingerprint_changes_detected INT NOT NULL DEFAULT 0,
    stale_approvals_count INT NOT NULL DEFAULT 0,
    expired_approvals_count INT NOT NULL DEFAULT 0,

    -- System health alerts
    system_health_status VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
    alert_message TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (snapshot_date)
);

-- Decision confidence decay tracking
CREATE TABLE IF NOT EXISTS confidence_decay_log (
    decay_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id UUID NOT NULL REFERENCES telemetry_facts(fact_id) ON DELETE CASCADE,
    enrichment_id UUID REFERENCES cognitive_enrichments(enrichment_id) ON DELETE SET NULL,

    initial_confidence NUMERIC(3, 2) NOT NULL,
    current_effective_confidence NUMERIC(3, 2) NOT NULL,
    days_since_evaluation INT NOT NULL,
    decay_factor NUMERIC(5, 4) NOT NULL,

    is_human_approved BOOLEAN NOT NULL DEFAULT FALSE,
    last_review_date TIMESTAMP WITH TIME ZONE,
    approval_status VARCHAR(50), -- FRESH, STALE, EXPIRED

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX idx_human_review_expiry ON human_review_ledger(expires_at);
CREATE INDEX idx_human_review_disagreement ON human_review_ledger(reviewed_at, is_disagreement);
CREATE INDEX idx_model_health_date ON model_health_ledger(snapshot_date);
CREATE INDEX idx_confidence_decay_fact ON confidence_decay_log(fact_id);
CREATE INDEX idx_confidence_decay_approval ON confidence_decay_log(is_human_approved, approval_status);
