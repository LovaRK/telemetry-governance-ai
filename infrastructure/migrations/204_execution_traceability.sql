-- Patch A: Execution Traceability
-- Adds requestId and model execution metadata persistence across run/job/decision layers.

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS model_name TEXT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS latency_ms INT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tokens_in INT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS tokens_out INT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS batch_count INT;

ALTER TABLE pipeline_stage_events ADD COLUMN IF NOT EXISTS request_id UUID;

ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS model_name TEXT;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS latency_ms INT;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS tokens_in INT;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS tokens_out INT;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS batch_count INT;

ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS tokens_in INT;
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS tokens_out INT;
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS batch_count INT;

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_request_id ON pipeline_runs(request_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_request_id ON job_queue(request_id);
CREATE INDEX IF NOT EXISTS idx_stage_events_request_id ON pipeline_stage_events(request_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_request_id ON agent_decisions(request_id);
