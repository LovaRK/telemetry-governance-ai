-- Add worker lease/heartbeat ownership to prevent indefinite RUNNING states.

ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS worker_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_lease ON job_queue(status, lease_expires_at);

