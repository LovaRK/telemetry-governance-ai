-- P4.9: Normalization Rollback Events
-- Tracks auto-rollback triggers when normalization variance exceeds thresholds.
-- When avg variance > 5% or max variance > 10%, the pipeline auto-disables
-- normalization and records the event here. Admin can re-enable by inserting
-- a row with auto_disabled=false.

CREATE TABLE IF NOT EXISTS normalization_rollback_events (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID,
    snapshot_id     UUID,
    trigger_type    TEXT NOT NULL,              -- 'avg_variance' | 'max_variance'
    avg_variance    NUMERIC(6,2) NOT NULL DEFAULT 0,
    max_variance    NUMERIC(6,2) NOT NULL DEFAULT 0,
    auto_disabled   BOOLEAN NOT NULL DEFAULT true,
    disabled_at     TIMESTAMPTZ,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rollback_tenant ON normalization_rollback_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rollback_disabled ON normalization_rollback_events(auto_disabled);
CREATE INDEX IF NOT EXISTS idx_rollback_created ON normalization_rollback_events(created_at DESC);
