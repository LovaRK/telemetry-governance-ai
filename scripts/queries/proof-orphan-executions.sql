-- Proof Query: Orphan Executions
--
-- Returns any execution_journal rows whose trace_id has no corresponding pipeline_events.
-- L4 Invariant: every traced execution must have at least one event in the event journal.
-- Orphans indicate either:
-- 1. Execution occurred but no events were emitted (event emission failure)
-- 2. Execution trace context was lost (async context loss)
-- This should return 0 rows.

SELECT
  ej.id,
  ej.decision_id,
  ej.trace_id,
  ej.status,
  ej.created_at,
  COUNT(pe.id) AS matching_events,
  'ORPHAN: no pipeline_events for trace_id' AS violation
FROM execution_journal ej
LEFT JOIN pipeline_events pe
  ON pe.trace_id = ej.trace_id
WHERE pe.trace_id IS NULL
  AND ej.trace_id IS NOT NULL
GROUP BY ej.id, ej.decision_id, ej.trace_id, ej.status, ej.created_at
ORDER BY ej.created_at DESC;
