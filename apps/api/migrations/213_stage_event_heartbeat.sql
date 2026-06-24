-- Migration 213: Add HEARTBEAT to pipeline_stage_events status constraint
-- Allows the worker to emit per-batch heartbeat events (status='HEARTBEAT') that:
--   1. keep lastStageAt fresh without polluting success/failure history
--   2. carry batchStartedAt, batchCompletedAt, durationMs for Ollama diagnostics
-- The cache-status route includes HEARTBEAT in MAX(started_at) so the idle timer
-- resets after every batch, not just at stage start.

ALTER TABLE pipeline_stage_events
  DROP CONSTRAINT IF EXISTS pipeline_stage_events_status_check;

ALTER TABLE pipeline_stage_events
  ADD CONSTRAINT pipeline_stage_events_status_check
    CHECK (status IN ('IN_PROGRESS', 'SUCCESS', 'FAILED', 'HEARTBEAT'));
