-- ============================================
-- Migration 019: Confidence Recovery & Anti-Distrust Mechanics
-- Date: 2026-05-18
-- Description: Prevent repeated small drift penalties from permanently destroying confidence
-- ============================================

-- Track stability runs: consecutive snapshots without drift
CREATE TABLE IF NOT EXISTS decision_stability_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id UUID NOT NULL REFERENCES agent_decisions(snapshot_id) ON DELETE CASCADE,
    index_name VARCHAR(200) NOT NULL,

    -- Current run metrics
    consecutive_clean_snapshots INTEGER NOT NULL DEFAULT 0,
    last_clean_snapshot_date DATE NOT NULL,
    drift_free_days INTEGER NOT NULL DEFAULT 0,

    -- Recovery tracking
    original_confidence NUMERIC(3, 2) NOT NULL,
    current_penalized_confidence NUMERIC(3, 2) NOT NULL,
    confidence_recovery_applied NUMERIC(3, 2) NOT NULL DEFAULT 0,
    confidence_after_recovery NUMERIC(3, 2) NOT NULL,

    -- Recovery acceleration (faster recovery for indices that stay stable longer)
    recovery_velocity_factor NUMERIC(4, 3) NOT NULL DEFAULT 1.0,
    last_penalty_event_date DATE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stability_runs_decision_id ON decision_stability_runs(decision_id);
CREATE INDEX idx_stability_runs_index_name ON decision_stability_runs(index_name);
CREATE INDEX idx_stability_runs_drift_free_days ON decision_stability_runs(drift_free_days DESC);

CREATE TRIGGER update_decision_stability_runs_updated_at
    BEFORE UPDATE ON decision_stability_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Confidence recovery milestones: when trust gets restored
CREATE TABLE IF NOT EXISTS confidence_recovery_milestones (
    milestone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES decision_stability_runs(run_id) ON DELETE CASCADE,
    index_name VARCHAR(200) NOT NULL,

    -- Recovery trigger
    stable_days_threshold INTEGER NOT NULL, -- 7, 14, 30, 60 days
    milestone_reached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Confidence before/after milestone
    confidence_before NUMERIC(3, 2) NOT NULL,
    recovery_amount NUMERIC(3, 2) NOT NULL,
    confidence_after NUMERIC(3, 2) NOT NULL,

    -- Milestone type
    milestone_type VARCHAR(50) NOT NULL, -- 'PARTIAL_14_DAY', 'FULL_30_DAY', 'ACCELERATED_RECOVERY'

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_milestones_run_id ON confidence_recovery_milestones(run_id);
CREATE INDEX idx_milestones_index_name ON confidence_recovery_milestones(index_name);
CREATE INDEX idx_milestones_type ON confidence_recovery_milestones(milestone_type);

-- Recovery schedule: defines at which stability thresholds confidence is restored
CREATE TABLE IF NOT EXISTS confidence_recovery_schedule (
    schedule_id SERIAL PRIMARY KEY,
    stable_days INTEGER NOT NULL UNIQUE,
    recovery_amount_pct NUMERIC(5, 2) NOT NULL,
    recovery_type VARCHAR(30) NOT NULL,
    description TEXT
);

-- Recovery schedule: 14 days stable = 25% recovery, 30 days = 50%, etc.
INSERT INTO confidence_recovery_schedule (stable_days, recovery_amount_pct, recovery_type, description) VALUES
    (7,  0.10, 'MINOR',     'Minor recovery: 7 days drift-free'),
    (14, 0.25, 'PARTIAL',   'Partial recovery: 2 weeks drift-free'),
    (30, 0.50, 'SUBSTANTIAL', '30 days drift-free: restore 50% of penalty'),
    (60, 0.75, 'MAJOR',     '60 days stable: restore 75% of penalty'),
    (90, 1.00, 'FULL',      '90 days stable: full confidence restoration')
ON CONFLICT DO NOTHING;

-- Anti-oscillation rules: prevent ping-pong drift decisions
CREATE TABLE IF NOT EXISTS decision_oscillation_detector (
    detector_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(200) NOT NULL UNIQUE,

    -- Oscillation tracking
    total_drift_events_30d INTEGER NOT NULL DEFAULT 0,
    total_recovery_events_30d INTEGER NOT NULL DEFAULT 0,
    oscillation_ratio NUMERIC(5, 2) NOT NULL DEFAULT 0,

    -- Oscillation state
    is_oscillating BOOLEAN NOT NULL DEFAULT FALSE,
    oscillation_severity VARCHAR(30), -- 'LOW', 'MEDIUM', 'HIGH'
    last_oscillation_detected TIMESTAMPTZ,

    -- Freeze confidence if oscillating severely
    confidence_freeze_until TIMESTAMPTZ,
    is_confidence_frozen BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oscillation_is_oscillating ON decision_oscillation_detector(is_oscillating);
CREATE INDEX idx_oscillation_frozen ON decision_oscillation_detector(is_confidence_frozen);

CREATE TRIGGER update_decision_oscillation_detector_updated_at
    BEFORE UPDATE ON decision_oscillation_detector
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
