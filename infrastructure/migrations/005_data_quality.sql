-- ============================================
-- Migration 005: Data Quality Tables
-- Date: 2026-05-16
-- Description: Create field_usage, security_coverage, and quality_hotspots tables
-- ============================================

-- Field Usage (populated by Splunk tstats field analysis)
CREATE TABLE IF NOT EXISTS field_usage (
    id              SERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    sourcetype      VARCHAR(200) NOT NULL,
    fields_indexed  INTEGER NOT NULL DEFAULT 0,
    fields_used     INTEGER NOT NULL DEFAULT 0,
    optimization_pct DECIMAL(5,1) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_usage_date ON field_usage(snapshot_date DESC);

-- Security Coverage (MITRE ATT&CK mapping)
CREATE TABLE IF NOT EXISTS security_coverage (
    id              SERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    sourcetype      VARCHAR(200) NOT NULL,
    coverage_pct    DECIMAL(5,1) NOT NULL DEFAULT 0,
    active_alerts   INTEGER NOT NULL DEFAULT 0,
    detection_gaps  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_coverage_date ON security_coverage(snapshot_date DESC);

-- Quality Hotspots (parse errors, timestamp issues per sourcetype)
CREATE TABLE IF NOT EXISTS quality_hotspots (
    id              SERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    sourcetype      VARCHAR(200) NOT NULL,
    issue_count     INTEGER NOT NULL DEFAULT 0,
    quality_score   DECIMAL(5,1) NOT NULL DEFAULT 0,
    estimated_impact TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_hotspots_date ON quality_hotspots(snapshot_date DESC);
