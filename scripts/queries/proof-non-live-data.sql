-- Proof Query: Non-Live Data in Execution Journal
--
-- Returns any execution_journal rows where mode is not 'live'.
-- L4 Invariant: mode must ALWAYS be 'live' per data purity constraint.
-- (Use replayed: boolean for delivery semantics, not mode field.)
-- This should return 0 rows.

SELECT
  id,
  decision_id,
  mode,
  created_at,
  'VIOLATION: mode <> live' AS violation
FROM execution_journal
WHERE mode IS NULL OR mode <> 'live'
ORDER BY created_at DESC;
