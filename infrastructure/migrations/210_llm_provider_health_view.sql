-- Migration 210: LLM provider health view
--
-- Operators query this to answer:
--   How often is Ollama being used vs template fallback?
--   What is average and P95 explanation latency by provider?
--   What is the current fallback rate?
--
-- The view is parameterless (queries all time). The application layer
-- filters by tenant_id and date window before querying the base table.
-- Inherits RLS from llm_execution_metrics.

CREATE OR REPLACE VIEW llm_provider_health AS
SELECT
  tenant_id,
  provider,
  COUNT(*)                                                           AS executions,
  ROUND(AVG(latency_ms))                                            AS avg_latency_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))  AS p95_latency_ms,
  MAX(latency_ms)                                                   AS max_latency_ms,
  ROUND(
    AVG(CASE WHEN fallback_used THEN 1.0 ELSE 0.0 END) * 100, 1
  )                                                                 AS fallback_pct,
  COUNT(*) FILTER (WHERE NOT success)                               AS error_count,
  MAX(created_at)                                                   AS last_seen
FROM llm_execution_metrics
GROUP BY tenant_id, provider;

COMMENT ON VIEW llm_provider_health IS
  'Operator visibility: executions, avg/P95 latency, fallback rate, per provider per tenant.';
