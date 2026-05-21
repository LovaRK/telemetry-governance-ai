-- Phase 1E-A: AI Traceability & Fault Classification Ledger

CREATE TABLE IF NOT EXISTS llm_health_cache (
  provider VARCHAR(50) PRIMARY KEY,
  available BOOLEAN NOT NULL DEFAULT FALSE,
  response_time_ms INT NOT NULL DEFAULT 0,
  queue_depth INT NOT NULL DEFAULT 0,
  running_model VARCHAR(100),
  inference_capacity VARCHAR(32) NOT NULL DEFAULT 'healthy',
  models_available TEXT[] NOT NULL DEFAULT '{}',
  fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pipeline_stage_events
  ADD COLUMN IF NOT EXISTS error_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stage_events_error_type_check'
  ) THEN
    ALTER TABLE pipeline_stage_events
      ADD CONSTRAINT pipeline_stage_events_error_type_check
      CHECK (error_type IS NULL OR error_type IN ('NETWORK','MODEL_MISSING','TIMEOUT','AUTH','PROMPT','UNKNOWN'));
  END IF;
END $$;

ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS decision_trace_id UUID,
  ADD COLUMN IF NOT EXISTS model_provider VARCHAR(50) NOT NULL DEFAULT 'ollama',
  ADD COLUMN IF NOT EXISTS model_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fallback_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS latency_ms INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_processed INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS system_prompt_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(100);

UPDATE agent_decisions
SET decision_trace_id = gen_random_uuid()
WHERE decision_trace_id IS NULL;

ALTER TABLE agent_decisions
  ALTER COLUMN decision_trace_id SET DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_decisions_fallback_reason_check'
  ) THEN
    ALTER TABLE agent_decisions
      ADD CONSTRAINT agent_decisions_fallback_reason_check
      CHECK (fallback_reason IS NULL OR fallback_reason IN ('MODEL_UNAVAILABLE','TIMEOUT','RATE_LIMIT','INFRASTRUCTURE_DOWN'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_decision_trace ON agent_decisions(decision_trace_id);

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(50),
  ADD COLUMN IF NOT EXISTS llm_model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS total_llm_tokens INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_llm_latency_ms INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fallback_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fallback_reason VARCHAR(50);

