-- ============================================
-- Migration 020: Rate-Limited & Budgeted Reanalysis Queue
-- Date: 2026-05-18
-- Description: Prevent drift storms from cascading into inference cluster collapse
-- ============================================

-- Priority tier for governance jobs
CREATE TYPE governance_priority_tier AS ENUM (
    'EMERGENCY',    -- System integrity threat (policy drift, legal hold)
    'CRITICAL',     -- Human rejected, blacklisted fingerprint
    'STANDARD',     -- Semantic drift requiring reanalysis
    'BACKGROUND',   -- Metric drift, ground truth sampling
    'DEFERRED'      -- Prompt version updates, low-priority reanalysis
);

-- Augmented reanalysis job queue with priority and budgeting
CREATE TABLE IF NOT EXISTS reanalysis_job_queue (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(200) NOT NULL,
    sourcetype VARCHAR(200),

    -- Job metadata
    trigger_source VARCHAR(50) NOT NULL, -- 'POLICY_DRIFT', 'SEMANTIC_DRIFT', 'HUMAN_REJECTED', 'PROMPT_BUMP', 'GROUND_TRUTH_SAMPLING'
    priority_tier governance_priority_tier NOT NULL DEFAULT 'STANDARD',

    -- Execution state machine
    execution_state VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, QUEUED, PROCESSING, COMPLETED, FAILED, DEFERRED
    execution_attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,

    -- Budget & rate limiting
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    execution_due_at TIMESTAMPTZ, -- When budget allows execution
    estimated_inference_cost_ms INTEGER, -- Hint for scheduling

    -- Failure tracking
    last_error_message TEXT,
    will_retry BOOLEAN NOT NULL DEFAULT TRUE,

    -- Governance context
    drift_severity VARCHAR(20),
    human_review_required BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_queue_execution_state ON reanalysis_job_queue(execution_state);
CREATE INDEX idx_queue_priority_tier ON reanalysis_job_queue(priority_tier);
CREATE INDEX idx_queue_queued_at ON reanalysis_job_queue(queued_at ASC);
CREATE INDEX idx_queue_execution_due_at ON reanalysis_job_queue(execution_due_at ASC);
CREATE INDEX idx_queue_pending_by_priority ON reanalysis_job_queue(priority_tier, execution_due_at)
    WHERE execution_state = 'PENDING';

CREATE TRIGGER update_reanalysis_job_queue_updated_at
    BEFORE UPDATE ON reanalysis_job_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Budget allocation tracker: prevents >5% of corpus from being reanalyzed per day
CREATE TABLE IF NOT EXISTS reanalysis_budget_ledger (
    budget_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_date DATE NOT NULL UNIQUE,

    -- Daily metrics
    total_indexes_in_corpus INTEGER NOT NULL,
    budget_max_reanalyses INTEGER NOT NULL, -- 5% of corpus
    reanalyses_completed_today INTEGER NOT NULL DEFAULT 0,
    budget_remaining INTEGER NOT NULL,

    -- Burst tracking
    emergency_jobs_executed INTEGER NOT NULL DEFAULT 0,
    critical_jobs_executed INTEGER NOT NULL DEFAULT 0,
    standard_jobs_executed INTEGER NOT NULL DEFAULT 0,
    background_jobs_deferred INTEGER NOT NULL DEFAULT 0,

    -- Budget state
    budget_exhausted_at TIMESTAMPTZ,
    budget_status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE, WARNING, EXHAUSTED

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_budget_date ON reanalysis_budget_ledger(budget_date DESC);
CREATE INDEX idx_budget_status ON reanalysis_budget_ledger(budget_status);

CREATE TRIGGER update_reanalysis_budget_ledger_updated_at
    BEFORE UPDATE ON reanalysis_budget_ledger
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Rate limiting matrix: max jobs per hour by priority tier
CREATE TABLE IF NOT EXISTS rate_limit_matrix (
    tier_id SERIAL PRIMARY KEY,
    priority_tier governance_priority_tier NOT NULL UNIQUE,
    max_jobs_per_hour INTEGER NOT NULL,
    max_concurrent_jobs INTEGER NOT NULL,
    retry_backoff_minutes INTEGER NOT NULL,
    description TEXT
);

-- Rate limits: emergency can run immediately, deferred trickles in background
INSERT INTO rate_limit_matrix (priority_tier, max_jobs_per_hour, max_concurrent_jobs, retry_backoff_minutes, description) VALUES
    ('EMERGENCY',  999, 10, 5,   'System threat: unlimited rate, 10 concurrent'),
    ('CRITICAL',   30,  5,  10,  'High priority: 30/hour, 5 concurrent'),
    ('STANDARD',   10,  2,  30,  'Normal: 10/hour, 2 concurrent'),
    ('BACKGROUND', 3,   1,  60,  'Low priority: 3/hour, serial'),
    ('DEFERRED',   1,   1,  120, 'Future: 1/hour or less, when budget available')
ON CONFLICT DO NOTHING;

-- Queue health metrics: monitor if queue is backing up
CREATE TABLE IF NOT EXISTS queue_health_snapshot (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL,

    -- Queue depth by tier
    pending_emergency INTEGER NOT NULL DEFAULT 0,
    pending_critical INTEGER NOT NULL DEFAULT 0,
    pending_standard INTEGER NOT NULL DEFAULT 0,
    pending_background INTEGER NOT NULL DEFAULT 0,
    pending_deferred INTEGER NOT NULL DEFAULT 0,
    total_pending INTEGER NOT NULL DEFAULT 0,

    -- Processing metrics
    jobs_completed_today INTEGER NOT NULL DEFAULT 0,
    avg_processing_time_ms NUMERIC(10, 2),
    jobs_failed_today INTEGER NOT NULL DEFAULT 0,
    queue_backlog_hours NUMERIC(8, 2),

    -- Health status
    queue_health_status VARCHAR(30) NOT NULL DEFAULT 'HEALTHY', -- HEALTHY, DEGRADED, CRITICAL_BACKLOG
    last_full_clear TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_queue_health_date ON queue_health_snapshot(snapshot_date DESC);
CREATE INDEX idx_queue_health_status ON queue_health_snapshot(queue_health_status);
