-- Migration 207: LLM execution metrics (P3)
-- Records every explanation call: provider, latency, fallback.
-- Enables P95 latency queries, fallback rate, provider health.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_execution_metrics (
  metric_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL,
  explanation_type  VARCHAR(30) NOT NULL,  -- executive_summary | sourcetype | governance
  sourcetype        TEXT,                  -- null for executive_summary
  provider          VARCHAR(20) NOT NULL,  -- ollama | anthropic | template
  model             TEXT,                  -- null for template fallback
  latency_ms        INT         NOT NULL DEFAULT 0,
  success           BOOLEAN     NOT NULL DEFAULT TRUE,
  fallback_used     BOOLEAN     NOT NULL DEFAULT FALSE,
  tokens_in         INT,
  tokens_out        INT,
  error_message     TEXT,                  -- null on success
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_metrics_tenant_time
  ON llm_execution_metrics (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_metrics_provider
  ON llm_execution_metrics (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_metrics_fallback
  ON llm_execution_metrics (fallback_used, created_at DESC);

ALTER TABLE llm_execution_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_metrics_tenant_policy ON llm_execution_metrics;
CREATE POLICY llm_metrics_tenant_policy ON llm_execution_metrics
  USING (tenant_id::text = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

COMMENT ON TABLE llm_execution_metrics IS
  'One row per explanation call. Enables latency/fallback monitoring without touching app logs.';
