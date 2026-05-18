-- ============================================
-- Migration 023: Asymmetric Recovery Controls & Seasonality-Aware Baselines
-- Date: 2026-05-18
-- Description: Add oscillation cooldowns, seasonality tracking, and time-class awareness
-- ============================================

-- Add asymmetric recovery control columns to decision_stability_runs
ALTER TABLE decision_stability_runs
ADD COLUMN IF NOT EXISTS historical_drift_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS recovery_cooldown_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS oscillation_multiplier NUMERIC(4, 3) NOT NULL DEFAULT 1.0;

CREATE INDEX IF NOT EXISTS idx_stability_historical_drift ON decision_stability_runs(historical_drift_count);
CREATE INDEX IF NOT EXISTS idx_stability_recovery_cooldown ON decision_stability_runs(recovery_cooldown_until)
    WHERE recovery_cooldown_until IS NOT NULL;

-- Seasonal baselines: track expected behavior for each time class
-- Examples: WEEKDAY vs WEEKEND, MONTH_END (reporting spike), QUARTER_END (compliance audit), PATCH_TUESDAY
CREATE TABLE IF NOT EXISTS index_seasonal_baselines (
    baseline_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(200) NOT NULL,
    time_class VARCHAR(50) NOT NULL, -- 'WEEKDAY', 'WEEKEND', 'MONTH_END', 'QUARTER_END', 'PATCH_TUESDAY', 'HOLIDAY_WINDOW', 'AUDIT_WINDOW', 'GENERAL'

    -- Volume EMA specific to this time class
    volume_ema NUMERIC(12, 4) NOT NULL,
    volume_stddev NUMERIC(12, 4) NOT NULL,

    -- Utilization P95 for this time class
    utilization_p95 NUMERIC(5, 2) NOT NULL,

    -- Metadata
    last_calibrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(index_name, time_class)
);

CREATE INDEX IF NOT EXISTS idx_seasonal_index_name ON index_seasonal_baselines(index_name);
CREATE INDEX IF NOT EXISTS idx_seasonal_time_class ON index_seasonal_baselines(time_class);
CREATE INDEX IF NOT EXISTS idx_seasonal_calibrated ON index_seasonal_baselines(last_calibrated_at DESC);

CREATE TRIGGER update_index_seasonal_baselines_updated_at
    BEFORE UPDATE ON index_seasonal_baselines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Time class reference table: defines expected behavior for each operational period
CREATE TABLE IF NOT EXISTS time_class_profiles (
    time_class VARCHAR(50) PRIMARY KEY,
    description VARCHAR(200) NOT NULL,
    expected_volume_factor NUMERIC(3, 2) NOT NULL, -- 0.3 (weekend) → 2.5 (quarter-end)
    expected_utilization_factor NUMERIC(3, 2) NOT NULL,
    high_variance BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT
);

-- Populate time class profiles
INSERT INTO time_class_profiles (time_class, description, expected_volume_factor, expected_utilization_factor, high_variance, notes) VALUES
    ('WEEKDAY',           'Normal Mon-Fri',                              1.0,  1.0, FALSE, 'Baseline operations'),
    ('WEEKEND',           'Sat-Sun reduced traffic',                     0.3,  0.2, TRUE,  'Reduced human operations, some automation'),
    ('MONTH_START',       'First 2 days of month',                       1.1,  1.1, TRUE,  'Month opening, metric review'),
    ('MONTH_END',         'Last 3 days (reconciliation, reporting)',     1.8,  2.2, TRUE,  'Finance close, reporting batch runs'),
    ('QUARTER_END',       'Last week of Q (compliance, financial close)', 2.5, 3.0, TRUE,  'Compliance audits, financial close procedures'),
    ('PATCH_TUESDAY',     '2nd Tuesday (MS/Linux system updates)',        1.4,  1.8, TRUE,  'System update spikes'),
    ('HOLIDAY_WINDOW',    'Dec 12 - Jan 3 (holidays)',                   0.5,  1.5, TRUE,  'Reduced staff, automation testing continues'),
    ('AUDIT_WINDOW',      'Quarterly audit periods',                     2.0,  2.5, TRUE,  'Internal/external audit runs'),
    ('GENERAL',           'General purpose baseline',                    1.0,  1.0, FALSE, 'Fallback for unclassified periods')
ON CONFLICT DO NOTHING;

-- Asymmetric recovery schedule (fast penalty, slow recovery)
CREATE TABLE IF NOT EXISTS recovery_asymmetry_config (
    config_id SERIAL PRIMARY KEY,
    description VARCHAR(200) NOT NULL UNIQUE,
    penalty_speed VARCHAR(20) NOT NULL, -- 'IMMEDIATE'
    recovery_speed VARCHAR(20) NOT NULL, -- 'SLOW'
    cooldown_days_per_drift_event INTEGER NOT NULL, -- 7 days per historical drift
    oscillation_velocity_formula VARCHAR(100) NOT NULL, -- "1.0 / (1.0 + historical_drift_count)"
    notes TEXT
);

INSERT INTO recovery_asymmetry_config (description, penalty_speed, recovery_speed, cooldown_days_per_drift_event, oscillation_velocity_formula, notes) VALUES
    ('Default asymmetric recovery', 'IMMEDIATE', 'SLOW', 7, '1.0 / (1.0 + historical_drift_count)',
     'Penalties are instant. Recovery is locked for 7 days per drift event. Recovery velocity throttled by oscillation multiplier.')
ON CONFLICT DO NOTHING;
