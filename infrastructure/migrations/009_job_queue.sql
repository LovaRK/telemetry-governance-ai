-- ============================================
-- Job Queue — async LLM processing pipeline
-- LLM never runs in HTTP request path.
-- Worker polls this table, claims jobs, processes in background.
-- ============================================

CREATE TABLE IF NOT EXISTS job_queue (
    id            SERIAL PRIMARY KEY,
    job_id        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    job_type      VARCHAR(50) NOT NULL DEFAULT 'llm_analysis',
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','partial','complete','failed')),
    snapshot_id   UUID,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    -- payload: { inputs: RawTelemetryInput[], config: {}, checkpoint: number }
    payload       JSONB NOT NULL DEFAULT '{}',
    -- progress: { batch: number, totalBatches: number, decisionsWritten: number }
    progress      JSONB NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status   ON job_queue(status);
CREATE INDEX IF NOT EXISTS idx_job_queue_job_id   ON job_queue(job_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_date     ON job_queue(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_job_queue_pending  ON job_queue(created_at) WHERE status = 'pending';
