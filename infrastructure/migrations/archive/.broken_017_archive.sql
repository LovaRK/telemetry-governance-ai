-- ============================================
-- Migration 017: Semantic Drift Detection Ledger
-- Date: 2026-05-18
-- Description: Track decision drift across metric dimensions, apply confidence penalties, trigger reanalysis
-- ============================================

-- Drift severity enum: how much the underlying data has changed
CREATE TYPE drift_severity AS ENUM ('NONE', 'NOISE', 'METRIC', 'SEMANTIC', 'POLICY');

-- Decision drift history — tracks when approved decisions become invalid due to metric changes
CREATE TABLE IF NOT EXISTS decision_drift_history (
    drift_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id UUID NOT NULL REFERENCES agent_decisions(snapshot_id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    index_name VARCHAR(200) NOT NULL,

    -- Drift vector: relative changes in key metrics compared to approval baseline
    drift_vector JSONB NOT NULL DEFAULT '{}', -- {vol_drift_pct, util_delta_pct, freshness_changed, retention_changed}

    -- Classification: how much reanalysis is needed
    drift_severity drift_severity NOT NULL DEFAULT 'NONE',

    -- Confidence impact: penalty applied to original decision confidence
    confidence_penalty NUMERIC(3, 2) NOT NULL DEFAULT 0.0, -- 0.0 to 1.0
    confidence_effective NUMERIC(3, 2) NOT NULL DEFAULT 0.0, -- original_confidence * (1 - penalty)

    -- Governance actions
    was_invalidated BOOLEAN NOT NULL DEFAULT FALSE,
    reanalysis_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    invalidation_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for rapid drift lookups
CREATE INDEX idx_drift_decision_id ON decision_drift_history(decision_id);
CREATE INDEX idx_drift_snapshot_date ON decision_drift_history(snapshot_date DESC);
CREATE INDEX idx_drift_index_name ON decision_drift_history(index_name);
CREATE INDEX idx_drift_severity ON decision_drift_history(drift_severity);
CREATE INDEX idx_drift_invalidated ON decision_drift_history(was_invalidated);
CREATE INDEX idx_drift_reanalysis_triggered ON decision_drift_history(reanalysis_triggered);

-- Trigger to update updated_at on drift history changes
CREATE TRIGGER update_decision_drift_history_updated_at
    BEFORE UPDATE ON decision_drift_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Drift severity threshold matrix: maps drift_severity to action
CREATE TABLE IF NOT EXISTS drift_action_matrix (
    matrix_id SERIAL PRIMARY KEY,
    drift_severity drift_severity NOT NULL UNIQUE,
    confidence_penalty_min NUMERIC(3, 2) NOT NULL,
    confidence_penalty_max NUMERIC(3, 2) NOT NULL,
    auto_invalidate BOOLEAN NOT NULL DEFAULT FALSE,
    trigger_reanalysis BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT
);

-- Populate drift action matrix with production rules
INSERT INTO drift_action_matrix (drift_severity, confidence_penalty_min, confidence_penalty_max, auto_invalidate, trigger_reanalysis, description) VALUES
    ('NONE',     0.00, 0.00, FALSE, FALSE, 'No significant drift — decision remains valid'),
    ('NOISE',    0.05, 0.15, FALSE, FALSE, 'Minor fluctuation in metrics — hold decision, monitor'),
    ('METRIC',   0.25, 0.50, FALSE, TRUE,  'Moderate metric change — trigger reanalysis'),
    ('SEMANTIC', 0.50, 0.80, TRUE,  TRUE,  'Significant meaning shift — invalidate and reanalyze'),
    ('POLICY',   0.80, 1.00, TRUE,  TRUE,  'Policy/requirement breach — immediate rejection')
ON CONFLICT DO NOTHING;

-- Extended agent_decisions with drift tracking references
ALTER TABLE agent_decisions
ADD COLUMN IF NOT EXISTS drift_detected BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS drift_severity drift_severity DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS drift_confidence_adjusted NUMERIC(3, 2);
