-- ============================================
-- Agentic Telemetry Operating System — PostgreSQL Schema
-- Production-grade, optimized for time-series + drilldown
-- ============================================

-- Telemetry Snapshots (primary serving layer)
CREATE TABLE IF NOT EXISTS telemetry_snapshots (
    id              SERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    granularity     VARCHAR(20) NOT NULL CHECK (granularity IN ('index', 'sourcetype')),
    parent_index    VARCHAR(200),           -- populated when granularity = 'sourcetype'
    index_name      VARCHAR(200) NOT NULL,
    sourcetype      VARCHAR(200),
    total_events    BIGINT NOT NULL DEFAULT 0,
    daily_avg_gb    DECIMAL(12,4) NOT NULL DEFAULT 0,
    retention_days  INTEGER NOT NULL DEFAULT 90,
    utilization_pct DECIMAL(5,2) NOT NULL DEFAULT 0,  -- daily query rate / volume
    cost_per_year   DECIMAL(12,2) NOT NULL DEFAULT 0,
    risk_score      DECIMAL(5,2) NOT NULL DEFAULT 0,   -- 0-100
    classification  VARCHAR(30) NOT NULL CHECK (classification IN ('KEEP','OPTIMIZE','ARCHIVE','ELIMINATE','INVESTIGATE')),
    confidence      DECIMAL(5,4) NOT NULL DEFAULT 0,    -- 0-1
    recommendation  TEXT,
    evidence        JSONB NOT NULL DEFAULT '[]',
    raw_metadata    JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for high-speed serving queries
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON telemetry_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_index ON telemetry_snapshots(index_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_gran_parent ON telemetry_snapshots(granularity, parent_index);
CREATE INDEX IF NOT EXISTS idx_snapshots_classification ON telemetry_snapshots(classification);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON telemetry_snapshots(created_at);

-- Time-series view helper: last 30 days
CREATE INDEX IF NOT EXISTS idx_snapshots_date_gran ON telemetry_snapshots(snapshot_date, granularity);

-- Unique constraint for upsert operations
-- Note: In PostgreSQL, two NULLs ARE considered equal for UNIQUE constraints,
-- so this correctly prevents duplicate (date, granularity, index, sourcetype) rows.
ALTER TABLE telemetry_snapshots
  ADD CONSTRAINT uq_snapshot_identity
  UNIQUE (snapshot_date, granularity, index_name, sourcetype);

-- Partitioning trigger function (for monthly partitions — can be enabled later)
-- CREATE TABLE telemetry_snapshots_2026_05 PARTITION OF telemetry_snapshots
--   FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- Cache Metadata (staleness tracking, refresh schedule)
CREATE TABLE IF NOT EXISTS cache_metadata (
    id              SERIAL PRIMARY KEY,
    cache_key       VARCHAR(100) NOT NULL UNIQUE,
    last_refresh_at TIMESTAMPTZ,
    next_refresh_at TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL CHECK (status IN ('fresh','stale','refreshing','error')),
    record_count    INTEGER NOT NULL DEFAULT 0,
    source_type     VARCHAR(50) NOT NULL DEFAULT 'splunk', -- 'splunk' or 'demo'
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cache Metadata indexes
CREATE INDEX IF NOT EXISTS idx_cache_status ON cache_metadata(status);
CREATE INDEX IF NOT EXISTS idx_cache_next_refresh ON cache_metadata(next_refresh_at);

-- Decision Trace Storage (audit log)
CREATE TABLE IF NOT EXISTS decision_traces (
    id              SERIAL PRIMARY KEY,
    trace_id        VARCHAR(100) NOT NULL,
    stage           VARCHAR(50) NOT NULL,
    stage_order     INTEGER NOT NULL,
    input           JSONB NOT NULL DEFAULT '{}',
    output          JSONB NOT NULL DEFAULT '{}',
    reasoning       TEXT,
    evidence        JSONB NOT NULL DEFAULT '[]',
    confidence      DECIMAL(5,4) NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON decision_traces(trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON decision_traces(timestamp);
CREATE INDEX IF NOT EXISTS idx_traces_stage ON decision_traces(stage);

-- Refresh Job Log
CREATE TABLE IF NOT EXISTS refresh_jobs (
    id              SERIAL PRIMARY KEY,
    job_type        VARCHAR(30) NOT NULL CHECK (job_type IN ('scheduled','manual','auto_stale')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL CHECK (status IN ('running','success','failed','partial')),
    records_inserted INTEGER NOT NULL DEFAULT 0,
    records_updated  INTEGER NOT NULL DEFAULT 0,
    error_count      INTEGER NOT NULL DEFAULT 0,
    duration_ms      INTEGER NOT NULL DEFAULT 0,
    error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_jobs_status ON refresh_jobs(status);
CREATE INDEX IF NOT EXISTS idx_refresh_jobs_started ON refresh_jobs(started_at);

-- ============================================
-- Utility Functions
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_telemetry_snapshots_updated_at
    BEFORE UPDATE ON telemetry_snapshots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cache_metadata_updated_at
    BEFORE UPDATE ON cache_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
