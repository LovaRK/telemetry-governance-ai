-- Ensure llm_health_cache contract exists at migration time for worker startup.

CREATE TABLE IF NOT EXISTS llm_health_cache (
  provider VARCHAR(50) PRIMARY KEY,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available BOOLEAN NOT NULL DEFAULT FALSE,
  response_time_ms INT NOT NULL DEFAULT 0,
  queue_depth INT NOT NULL DEFAULT 0,
  running_model VARCHAR(100),
  inference_capacity VARCHAR(32) NOT NULL DEFAULT 'healthy',
  models_available TEXT[] NOT NULL DEFAULT '{}',
  fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS provider VARCHAR(50);
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS response_time_ms INT NOT NULL DEFAULT 0;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS queue_depth INT NOT NULL DEFAULT 0;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS running_model VARCHAR(100);
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS inference_capacity VARCHAR(32) NOT NULL DEFAULT 'healthy';
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS models_available TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE;

