-- Migration 213: Add HEARTBEAT to pipeline_stage_events status constraint
--
-- The worker emits per-batch heartbeat events (status='HEARTBEAT') that:
--   1. keep lastStageAt fresh without polluting success/failure history
--   2. carry batchStartedAt, batchCompletedAt, durationMs for Ollama diagnostics
-- The cache-status route includes HEARTBEAT in MAX(started_at) so the idle timer
-- resets after every batch, not just at stage start.
--
-- Fresh-install + upgrade safety:
--   * On a brand-new database, pipeline_stage_events doesn't exist yet (it is
--     created lazily by ensurePipelineLedgerSchema() in pipeline-ledger-service,
--     which already lists HEARTBEAT in the CHECK after this PR). The DO block
--     below skips the ALTER when the table is absent — no error.
--   * On an upgraded database, the table exists with the old constraint; the
--     DO block drops the old CHECK and adds the HEARTBEAT-aware one.
-- Re-running this migration is safe in both states.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pipeline_stage_events'
  ) THEN
    ALTER TABLE pipeline_stage_events
      DROP CONSTRAINT IF EXISTS pipeline_stage_events_status_check;

    ALTER TABLE pipeline_stage_events
      ADD CONSTRAINT pipeline_stage_events_status_check
        CHECK (status IN ('IN_PROGRESS', 'SUCCESS', 'FAILED', 'HEARTBEAT'));
  END IF;
END
$$;
