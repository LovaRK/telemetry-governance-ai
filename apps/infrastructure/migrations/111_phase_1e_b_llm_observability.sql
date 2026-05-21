-- Phase 1E-B: Enterprise Infrastructure Ledger (Production Hardened)

CREATE TABLE IF NOT EXISTS llm_health_history (
  health_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  available BOOLEAN NOT NULL,
  response_time_ms INT NOT NULL,
  checked_duration_ms INT NOT NULL,
  queue_depth INT,
  running_model VARCHAR(100),
  inference_capacity VARCHAR(32) NOT NULL CHECK (inference_capacity IN ('healthy', 'degraded', 'down', 'warming', 'throttled', 'maintenance')),
  error_reason VARCHAR(100),
  models_available TEXT[] NOT NULL DEFAULT '{}',
  fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  daemon_version VARCHAR(32) NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checked ON llm_health_history(checked_at DESC);

CREATE TABLE IF NOT EXISTS llm_health_cache (
  provider VARCHAR(50) PRIMARY KEY,
  last_health_id UUID,
  last_successful_poll_at TIMESTAMPTZ,
  total_polls BIGINT NOT NULL DEFAULT 0,
  successful_polls BIGINT NOT NULL DEFAULT 0,
  failed_polls BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS last_health_id UUID;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS last_successful_poll_at TIMESTAMPTZ;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS total_polls BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS successful_polls BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS failed_polls BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_health_cache ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'llm_health_cache_last_health_id_fkey'
  ) THEN
    ALTER TABLE llm_health_cache
      ADD CONSTRAINT llm_health_cache_last_health_id_fkey
      FOREIGN KEY (last_health_id) REFERENCES llm_health_history(health_id) ON DELETE CASCADE;
  END IF;
END $$;
