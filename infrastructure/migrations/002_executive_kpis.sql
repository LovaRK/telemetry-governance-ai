-- ============================================
-- Migration 002: Executive KPIs Table
-- Date: 2026-05-16
-- Description: Create executive_kpis table for LLM agent output aggregation
-- ============================================

-- Executive KPIs (LLM agent output — one row per snapshot day)
CREATE TABLE IF NOT EXISTS executive_kpis (
    id                        SERIAL PRIMARY KEY,
    snapshot_id               UUID NOT NULL DEFAULT gen_random_uuid(),
    snapshot_date             DATE NOT NULL UNIQUE,
    roi_score                 DECIMAL(5,2) NOT NULL DEFAULT 0,
    gainscope_score           DECIMAL(5,2) NOT NULL DEFAULT 0,
    total_license_spend       DECIMAL(14,2) NOT NULL DEFAULT 0,
    license_spend_low_value   DECIMAL(14,2) NOT NULL DEFAULT 0,
    storage_savings_potential DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_daily_gb            DECIMAL(12,4) NOT NULL DEFAULT 0,
    total_sourcetypes         INTEGER NOT NULL DEFAULT 0,
    tier_critical             INTEGER NOT NULL DEFAULT 0,
    tier_important            INTEGER NOT NULL DEFAULT 0,
    tier_nice_to_have         INTEGER NOT NULL DEFAULT 0,
    tier_low_value            INTEGER NOT NULL DEFAULT 0,
    security_gaps             INTEGER NOT NULL DEFAULT 0,
    operational_gaps          INTEGER NOT NULL DEFAULT 0,
    avg_utilization           DECIMAL(5,2) NOT NULL DEFAULT 0,
    avg_detection             DECIMAL(5,2) NOT NULL DEFAULT 0,
    avg_quality               DECIMAL(5,2) NOT NULL DEFAULT 0,
    avg_confidence            DECIMAL(5,2) NOT NULL DEFAULT 0,
    quick_wins                JSONB NOT NULL DEFAULT '[]',
    savings_staircase         JSONB NOT NULL DEFAULT '[]',
    agent_reasoning           TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exec_kpis_date ON executive_kpis(snapshot_date DESC);

CREATE TRIGGER update_executive_kpis_updated_at
    BEFORE UPDATE ON executive_kpis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
