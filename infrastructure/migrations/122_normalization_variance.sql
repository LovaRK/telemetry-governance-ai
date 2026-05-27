-- Migration 122: Normalization Variance Shadow Comparison
-- Tracks KPI deltas between raw-input scoring and canonical normalization scoring.
-- Persisted during shadow mode (NORMALIZATION_SHADOW_COMPARE=true) to enable
-- rollout decision-making.

CREATE TABLE IF NOT EXISTS normalization_variance (
    id                BIGSERIAL PRIMARY KEY,
    tenant_id         UUID,
    source_type       TEXT,
    old_roi           NUMERIC(8,2) NOT NULL DEFAULT 0,
    new_roi           NUMERIC(8,2) NOT NULL DEFAULT 0,
    old_gain_scope    NUMERIC(8,2) NOT NULL DEFAULT 0,
    new_gain_scope    NUMERIC(8,2) NOT NULL DEFAULT 0,
    old_low_value_spend NUMERIC(14,2) NOT NULL DEFAULT 0,
    new_low_value_spend NUMERIC(14,2) NOT NULL DEFAULT 0,
    variance_pct      NUMERIC(6,2) NOT NULL DEFAULT 0,
    snapshot_id       UUID,
    pipeline_run_id   UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_norm_variance_tenant
    ON normalization_variance(tenant_id);

CREATE INDEX IF NOT EXISTS idx_norm_variance_created
    ON normalization_variance(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_norm_variance_snapshot
    ON normalization_variance(snapshot_id);
