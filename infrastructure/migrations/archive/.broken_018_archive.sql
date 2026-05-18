-- ============================================
-- Migration 018: Rolling Baseline Windows for Statistical Drift
-- Date: 2026-05-18
-- Description: Replace threshold-based drift with EMA + variance bands
-- ============================================

-- Smoothing factor tiers for different operational sensitivity
CREATE TYPE baseline_sensitivity_tier AS ENUM ('FAST', 'STANDARD', 'STABLE');

-- Rolling baseline windows: EMA + variance for each metric
CREATE TABLE IF NOT EXISTS index_rolling_baselines (
    baseline_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(200) NOT NULL UNIQUE,
    sourcetype VARCHAR(200),

    -- Baseline sensitivity tier (determines α smoothing factor)
    sensitivity_tier baseline_sensitivity_tier NOT NULL DEFAULT 'STANDARD',

    -- Volume drift (daily_avg_gb) EMA tracking
    volume_ema_gb NUMERIC(12, 4) NOT NULL DEFAULT 0,
    volume_variance_gb NUMERIC(12, 4) NOT NULL DEFAULT 0,
    volume_last_update TIMESTAMPTZ DEFAULT NOW(),

    -- Utilization EMA tracking (query rate %)
    utilization_ema_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
    utilization_variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
    utilization_last_update TIMESTAMPTZ DEFAULT NOW(),

    -- Retention window tracking (policy changes)
    retention_ema_days NUMERIC(5, 1) NOT NULL DEFAULT 90,
    retention_variance_days NUMERIC(5, 1) NOT NULL DEFAULT 0,
    retention_policy_hash VARCHAR(64),
    retention_last_update TIMESTAMPTZ DEFAULT NOW(),

    -- Search frequency moving average (invocations per day)
    search_freq_ema NUMERIC(8, 2) NOT NULL DEFAULT 0,
    search_freq_variance NUMERIC(8, 2) NOT NULL DEFAULT 0,
    search_freq_last_update TIMESTAMPTZ DEFAULT NOW(),

    -- Freshness window (days since last event)
    freshness_ema_days NUMERIC(5, 1) NOT NULL DEFAULT 1,
    freshness_variance_days NUMERIC(5, 1) NOT NULL DEFAULT 0,
    freshness_last_update TIMESTAMPTZ DEFAULT NOW(),

    -- Control band parameters (k-factor for standard deviations)
    control_band_k NUMERIC(3, 1) NOT NULL DEFAULT 3.0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for baseline lookups
CREATE INDEX idx_baselines_index_name ON index_rolling_baselines(index_name);
CREATE INDEX idx_baselines_sensitivity_tier ON index_rolling_baselines(sensitivity_tier);
CREATE INDEX idx_baselines_updated ON index_rolling_baselines(updated_at DESC);

-- Trigger for updated_at maintenance
CREATE TRIGGER update_index_rolling_baselines_updated_at
    BEFORE UPDATE ON index_rolling_baselines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Drift envelope violations: track when metrics break control bands
CREATE TABLE IF NOT EXISTS drift_envelope_violations (
    violation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(200) NOT NULL,
    snapshot_date DATE NOT NULL,

    -- Which metric violated
    violated_metric VARCHAR(50) NOT NULL, -- 'volume', 'utilization', 'retention', 'search_freq', 'freshness'

    -- Current value vs envelope boundaries
    current_value NUMERIC(12, 4) NOT NULL,
    ema_baseline NUMERIC(12, 4) NOT NULL,
    variance_sigma NUMERIC(12, 4) NOT NULL,
    k_factor NUMERIC(3, 1) NOT NULL,

    -- Boundaries
    lower_bound NUMERIC(12, 4) NOT NULL,
    upper_bound NUMERIC(12, 4) NOT NULL,

    -- Severity of violation (how many sigmas away)
    sigma_distance NUMERIC(8, 2) NOT NULL,

    -- Whether this triggered drift classification
    triggered_drift_classification BOOLEAN NOT NULL DEFAULT FALSE,
    drift_severity VARCHAR(20),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_violations_index_date ON drift_envelope_violations(index_name, snapshot_date DESC);
CREATE INDEX idx_violations_metric ON drift_envelope_violations(violated_metric);
CREATE INDEX idx_violations_triggered_drift ON drift_envelope_violations(triggered_drift_classification);

-- Smoothing factor lookup table (α values by sensitivity tier and lookback window)
CREATE TABLE IF NOT EXISTS smoothing_factor_matrix (
    tier_id SERIAL PRIMARY KEY,
    sensitivity_tier baseline_sensitivity_tier NOT NULL UNIQUE,
    alpha_smoothing NUMERIC(5, 4) NOT NULL,
    description TEXT,
    recommended_window_days INTEGER NOT NULL
);

-- Populate smoothing factors
INSERT INTO smoothing_factor_matrix (sensitivity_tier, alpha_smoothing, description, recommended_window_days) VALUES
    ('FAST',     0.26, 'Emergency detection: 7-day effective window',   7),
    ('STANDARD', 0.12, 'Production tier: 14-day effective window',     14),
    ('STABLE',   0.067, 'Enterprise tier: 30-day effective window',     30)
ON CONFLICT DO NOTHING;
