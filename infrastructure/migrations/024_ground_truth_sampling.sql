-- ============================================
-- Migration 024: Ground Truth Sampling Infrastructure
-- Date: 2026-05-18
-- Description: Tables for continuous human audit of high-risk decisions
-- ============================================

-- Ground truth sampling runs: metadata for each sampling campaign
CREATE TABLE IF NOT EXISTS ground_truth_sampling_runs (
    sampling_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sampling_date DATE NOT NULL,
    candidates_evaluated INTEGER NOT NULL,
    samples_selected INTEGER NOT NULL,
    total_risk_covered NUMERIC(12, 2) NOT NULL,
    explanation TEXT,
    execution_status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED', -- COMPLETED, FAILED, IN_PROGRESS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sampling_runs_date ON ground_truth_sampling_runs(sampling_date DESC);
CREATE INDEX IF NOT EXISTS idx_sampling_runs_status ON ground_truth_sampling_runs(execution_status);

CREATE TRIGGER update_ground_truth_sampling_runs_updated_at
    BEFORE UPDATE ON ground_truth_sampling_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Individual samples selected for human review
CREATE TABLE IF NOT EXISTS ground_truth_samples (
    sample_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sampling_run_id UUID NOT NULL REFERENCES ground_truth_sampling_runs(sampling_run_id),
    index_name VARCHAR(200) NOT NULL,

    -- Risk metrics for this sample
    effective_confidence NUMERIC(4, 3) NOT NULL, -- 0.0 to 1.0
    reuse_depth INTEGER NOT NULL, -- how many times this decision is reused
    financial_impact_usd NUMERIC(12, 2) NOT NULL, -- USD value of decision
    policy_weight NUMERIC(3, 1) NOT NULL, -- 1.0 to 3.5 (compliance multiplier)
    sampling_probability NUMERIC(4, 3) NOT NULL, -- P_s from formula
    risk_score NUMERIC(12, 2) NOT NULL, -- composite ranking metric

    -- Human review tracking
    human_review_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_REVIEW', -- PENDING_REVIEW, APPROVED, FLAGGED, REVIEW_COMPLETE
    human_review_outcome VARCHAR(50), -- APPROVED, NEEDS_REANALYSIS, DRIFT_DETECTED, DISCARDED
    human_review_comments TEXT,
    human_review_completed_at TIMESTAMPTZ,
    reviewed_by_user_id VARCHAR(200), -- who did the review

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_samples_run_id ON ground_truth_samples(sampling_run_id);
CREATE INDEX IF NOT EXISTS idx_samples_index_name ON ground_truth_samples(index_name);
CREATE INDEX IF NOT EXISTS idx_samples_review_status ON ground_truth_samples(human_review_status);
CREATE INDEX IF NOT EXISTS idx_samples_risk_score ON ground_truth_samples(risk_score DESC);

CREATE TRIGGER update_ground_truth_samples_updated_at
    BEFORE UPDATE ON ground_truth_samples
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Reanalysis job queue migration
-- Add fields to track ground truth sampling reanalysis context
ALTER TABLE reanalysis_job_queue
ADD COLUMN IF NOT EXISTS sampling_run_id UUID REFERENCES ground_truth_sampling_runs(sampling_run_id),
ADD COLUMN IF NOT EXISTS is_ground_truth_audit BOOLEAN NOT NULL DEFAULT FALSE;

-- Create index for ground truth audit jobs
CREATE INDEX IF NOT EXISTS idx_queue_ground_truth ON reanalysis_job_queue(is_ground_truth_audit)
    WHERE is_ground_truth_audit = TRUE;

-- Sampling campaign statistics view
CREATE OR REPLACE VIEW sampling_statistics_30d AS
SELECT
    COUNT(DISTINCT gsr.sampling_run_id) as total_runs,
    COUNT(gs.sample_id) as total_samples,
    AVG(gsr.samples_selected) as avg_samples_per_run,
    SUM(gsr.total_risk_covered) as total_risk_covered,
    COUNT(DISTINCT CASE WHEN gs.human_review_status = 'REVIEW_COMPLETE' THEN gs.sample_id END) as reviews_completed,
    AVG(gs.effective_confidence) as avg_confidence_sampled,
    COUNT(DISTINCT CASE WHEN gs.human_review_outcome = 'DRIFT_DETECTED' THEN gs.sample_id END) as drift_detections
FROM ground_truth_sampling_runs gsr
LEFT JOIN ground_truth_samples gs ON gsr.sampling_run_id = gs.sampling_run_id
WHERE gsr.sampling_date >= CURRENT_DATE - INTERVAL '30 days';
