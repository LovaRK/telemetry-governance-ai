-- ============================================
-- Migration 012: Incremental Processing Fields
-- Date: 2026-05-18
-- Description: Add fields for snapshot diffing, AI lineage, and decision stability
-- ============================================

-- Add columns to agent_decisions for AI lineage & reproducibility
ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS metadata_fingerprint VARCHAR(64),
  ADD COLUMN IF NOT EXISTS llm_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS model_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS heuristic_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_checksum VARCHAR(64),
  ADD COLUMN IF NOT EXISTS last_llm_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_stability_score DECIMAL(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(30) DEFAULT 'unchanged';

-- Create table to track snapshot metadata for diffing
CREATE TABLE IF NOT EXISTS snapshot_metadata (
    id                      SERIAL PRIMARY KEY,
    snapshot_id             UUID NOT NULL UNIQUE,
    snapshot_date           DATE NOT NULL,

    -- Indexing
    total_indexes           INT NOT NULL,
    total_sourcetypes       INT NOT NULL,

    -- Processing metadata
    llm_version             VARCHAR(50) NOT NULL,
    prompt_version          VARCHAR(50) NOT NULL,
    model_version           VARCHAR(50) NOT NULL,
    heuristic_version       VARCHAR(50) NOT NULL,

    -- Diffing info
    indexes_unchanged       INT DEFAULT 0,
    indexes_changed         INT DEFAULT 0,
    indexes_new             INT DEFAULT 0,
    indexes_removed         INT DEFAULT 0,

    -- Processing stats
    total_llm_queries       INT DEFAULT 0,
    avg_inference_latency_ms DECIMAL(10,2),
    worker_memory_peak_mb   INT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_snapshot_by_date UNIQUE (snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_metadata_date
  ON snapshot_metadata(snapshot_date DESC);

-- Create table to track index metadata fingerprints across snapshots
CREATE TABLE IF NOT EXISTS index_metadata_history (
    id                      SERIAL PRIMARY KEY,
    snapshot_date           DATE NOT NULL,
    index_name              VARCHAR(200) NOT NULL,
    sourcetype              VARCHAR(200),

    -- Current snapshot metadata
    metadata_fingerprint    VARCHAR(64) NOT NULL,
    daily_avg_gb            DECIMAL(14,4),
    total_events            BIGINT,
    retention_days          INT,
    last_event_epoch        BIGINT,

    -- Diffing
    changed_from_prev       BOOLEAN DEFAULT FALSE,
    change_type             VARCHAR(30), -- 'new', 'changed', 'unchanged', 'removed'

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_index_snapshot UNIQUE (snapshot_date, index_name, sourcetype)
);

CREATE INDEX IF NOT EXISTS idx_index_metadata_history_index
  ON index_metadata_history(index_name);
CREATE INDEX IF NOT EXISTS idx_index_metadata_history_date
  ON index_metadata_history(snapshot_date DESC);

-- Add candidate_reason structured format (evolution from TEXT[])
ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS candidate_reasons JSONB DEFAULT '[]';

-- Create table for decision overrides (governance)
CREATE TABLE IF NOT EXISTS decision_overrides (
    id                      SERIAL PRIMARY KEY,
    snapshot_id             UUID NOT NULL,
    index_name              VARCHAR(200) NOT NULL,

    -- Original decision
    original_action         VARCHAR(30) NOT NULL,
    original_confidence     DECIMAL(5,2),

    -- Override
    override_action         VARCHAR(30) NOT NULL,
    override_reason         TEXT NOT NULL,
    override_actor          VARCHAR(200) NOT NULL,

    -- Governance
    override_expiry         DATE,
    review_required         BOOLEAN DEFAULT FALSE,
    reviewed_at             TIMESTAMPTZ,
    reviewed_by             VARCHAR(200),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_overrides_index
  ON decision_overrides(index_name);
CREATE INDEX IF NOT EXISTS idx_decision_overrides_snapshot
  ON decision_overrides(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_decision_overrides_expiry
  ON decision_overrides(override_expiry) WHERE override_expiry IS NOT NULL;

CREATE TRIGGER update_decision_overrides_updated_at
    BEFORE UPDATE ON decision_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
