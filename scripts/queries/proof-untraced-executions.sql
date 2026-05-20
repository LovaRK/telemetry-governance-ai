-- Proof Query: Untraced Executions
--
-- Returns any execution_journal rows without a trace_id.
-- L4 Invariant: this should return 0 rows.
-- If non-empty, trace context injection failed in one or more routes.

SELECT
  id,
  decision_id,
  idempotency_key,
  status,
  created_at,
  updated_at,
  'VIOLATION: trace_id IS NULL' AS violation
FROM execution_journal
WHERE trace_id IS NULL
ORDER BY created_at DESC;
