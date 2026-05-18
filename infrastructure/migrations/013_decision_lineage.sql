-- ============================================
-- Migration 013: Decision Lineage & Provenance
-- Date: 2026-05-18
-- Description: Audit trail with full signal provenance
-- ============================================

-- Decision lineage table (audit trail for every decision)
CREATE TABLE IF NOT EXISTS decision_lineage (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id             UUID NOT NULL,
    index_name              VARCHAR(200) NOT NULL,
    sourcetype              VARCHAR(200),

    -- Deterministic layer signals (immutable facts from Splunk)
    deterministic_signals   JSONB NOT NULL,
    -- {
    --   "daily_avg_gb_change_pct": 412,
    --   "cost_per_year_usd": 15840,
    --   "retention_days": 2555,
    --   "days_since_last_event": 91,
    --   "utilization_pct": 0.3,
    --   "search_count_30d": 0
    -- }

    -- AI enrichment signals (versioned, reproducible)
    cognitive_signals       JSONB,
    -- {
    --   "model": "gemma2:9b",
    --   "model_version": "2.0",
    --   "prompt_hash": "sha256:abc123...",
    --   "temperature": 0.7,
    --   "confidence_score": 0.88,
    --   "reasoning": "Pattern matches ephemeral debug logging...",
    --   "inference_tokens": 342,
    --   "latency_ms": 1203
    -- }

    -- Human governance gate
    decision_status         VARCHAR(50) NOT NULL DEFAULT 'PROPOSED',
    -- PROPOSED → REVIEW_QUEUE → APPLIED / DISMISSED
    reviewed_by             VARCHAR(200),
    reviewed_at             TIMESTAMPTZ,
    applied_at              TIMESTAMPTZ,
    dismissal_reason        TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_lineage_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshot_metadata(snapshot_id),
    CONSTRAINT uq_lineage_identity UNIQUE (snapshot_id, index_name, sourcetype)
);

CREATE INDEX IF NOT EXISTS idx_decision_lineage_status
  ON decision_lineage(decision_status);
CREATE INDEX IF NOT EXISTS idx_decision_lineage_snapshot
  ON decision_lineage(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_decision_lineage_timestamp
  ON decision_lineage(created_at DESC);

-- Queue health metrics (platform observability)
CREATE TABLE IF NOT EXISTS queue_health_metrics (
    id                              SERIAL PRIMARY KEY,
    snapshot_date                   DATE NOT NULL,
    snapshot_id                     UUID,

    -- Reuse effectiveness
    reuse_ratio                     DECIMAL(5, 4),     -- target: >0.90, alert: <0.75
    unchanged_indexes               INT,
    total_indexes                   INT,

    -- Queue health
    queue_depth                     INT,               -- pending jobs, target: near 0
    queue_depth_max_observed        INT,               -- peak observed this snapshot
    processing_time_p95_ms          INT,               -- 95th percentile job time

    -- Decision stability
    decision_flip_rate              DECIMAL(5, 4),     -- week-over-week changes, target: <0.05
    flip_count                      INT,
    unstable_decisions              INT,               -- decisions marked unstable (flip_rate > 0.3)

    -- Candidate filtering efficiency
    candidates_sent_to_ai           INT,
    filtering_efficiency_pct        DECIMAL(5, 2),     -- target: <10%, alert: >75%

    -- Hardware utilization
    avg_inference_latency_ms        INT,
    worker_memory_peak_mb           INT,
    worker_count_active             INT,

    -- Decision quality
    high_confidence_proposals       INT,               -- confidence >= 0.95
    medium_confidence_proposals     INT,               -- 0.70 <= confidence < 0.95
    low_confidence_proposals        INT,               -- confidence < 0.70

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_queue_metrics_date UNIQUE (snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_queue_metrics_date
  ON queue_health_metrics(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_queue_metrics_reuse
  ON queue_health_metrics(reuse_ratio DESC);

-- Trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_decision_lineage_updated_at
    BEFORE UPDATE ON decision_lineage
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- View for quick status breakdown (governance dashboard)
CREATE OR REPLACE VIEW decision_status_summary AS
SELECT
    snapshot_id,
    decision_status,
    COUNT(*) as count,
    ROUND(AVG((cognitive_signals->>'confidence_score')::NUMERIC), 2) as avg_confidence,
    MAX(created_at) as latest_decision
FROM decision_lineage
GROUP BY snapshot_id, decision_status
ORDER BY snapshot_id DESC, decision_status;
