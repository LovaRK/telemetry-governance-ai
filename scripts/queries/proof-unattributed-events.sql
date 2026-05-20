-- Proof Query: Unattributed Pipeline Events
--
-- Returns any pipeline_events rows missing trace_id, source, or with mode != 'live'.
-- L4 Invariant: every event must be attributed (have source lineage and trace context).
-- This should return 0 rows.

SELECT
  id,
  event_type,
  correlation_id,
  trace_id,
  source,
  mode,
  timestamp,
  CASE
    WHEN trace_id IS NULL THEN 'VIOLATION: trace_id IS NULL'
    WHEN source IS NULL THEN 'VIOLATION: source IS NULL'
    WHEN mode IS NULL THEN 'VIOLATION: mode IS NULL'
    WHEN mode <> 'live' THEN 'VIOLATION: mode <> live'
    ELSE 'OK'
  END AS violation
FROM pipeline_events
WHERE trace_id IS NULL
   OR source IS NULL
   OR mode IS NULL
   OR mode <> 'live'
ORDER BY timestamp DESC;
