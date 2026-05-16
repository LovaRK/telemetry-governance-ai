-- ============================================
-- Migration 003: Agent Decisions Table
-- Date: 2026-05-16
-- Description: Create agent_decisions table for storing individual index/sourcetype decisions from LLM
-- ============================================

-- Agent Decisions (one row per index/sourcetype decision per day)
CREATE TABLE IF NOT EXISTS agent_decisions (
    id                  SERIAL PRIMARY KEY,
    snapshot_id         UUID NOT NULL,
    snapshot_date       DATE NOT NULL,
    index_name          VARCHAR(200) NOT NULL,
    sourcetype          VARCHAR(200),
    tier                VARCHAR(50),
    action              VARCHAR(30),
    composite_score     DECIMAL(5,2) DEFAULT 0,
    utilization_score   DECIMAL(5,2) DEFAULT 0,
    detection_score     DECIMAL(5,2) DEFAULT 0,
    quality_score       DECIMAL(5,2) DEFAULT 0,
    risk_score          DECIMAL(5,2) DEFAULT 0,
    annual_license_cost DECIMAL(14,2) DEFAULT 0,
    estimated_savings   DECIMAL(14,2) DEFAULT 0,
    confidence          DECIMAL(5,4) DEFAULT 0,
    confidence_score    DECIMAL(5,2) DEFAULT 0,
    recommendation      TEXT,
    reasoning           TEXT,
    evidence            JSONB NOT NULL DEFAULT '[]',
    is_quick_win        BOOLEAN DEFAULT FALSE,
    is_s3_candidate     BOOLEAN DEFAULT FALSE,
    detection_gap       BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_date ON agent_decisions(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_index ON agent_decisions(index_name);

-- Unique constraint for upsert operations
ALTER TABLE agent_decisions
  ADD CONSTRAINT uq_agent_decision_identity
  UNIQUE (snapshot_id, index_name, sourcetype);

CREATE TRIGGER update_agent_decisions_updated_at
    BEFORE UPDATE ON agent_decisions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
