-- ============================================
-- Migration 004: Search Audit Table
-- Date: 2026-05-16
-- Description: Create search_audit table for saved searches and alerts tracking
-- ============================================

-- Search Audit (saved searches + alerts from Splunk REST)
CREATE TABLE IF NOT EXISTS search_audit (
    id              SERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    search_name     VARCHAR(500) NOT NULL,
    search_type     VARCHAR(50),
    app             VARCHAR(200),
    schedule        VARCHAR(200),
    is_scheduled    BOOLEAN DEFAULT FALSE,
    is_alert        BOOLEAN DEFAULT FALSE,
    last_run        TIMESTAMPTZ,
    confidence_score DECIMAL(5,2) DEFAULT 0,
    reason          TEXT,
    status          VARCHAR(30),
    risk_level      VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    is_unused       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_audit_date ON search_audit(snapshot_date DESC);
