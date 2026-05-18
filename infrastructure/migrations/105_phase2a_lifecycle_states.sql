-- ============================================================
-- Migration 105: Phase 2A Queue Boundary Lifecycle States
-- ============================================================
-- Adds queue-specific lifecycle states to mutation_lifecycle_events
--
-- Queue boundary adds these states to the standard lifecycle:
-- - QUEUE_ENQUEUED: Job submitted to queue (producer)
-- - JOB_EXECUTION_START: Job dequeued and execution begins (consumer)
-- - JOB_EXECUTION_SUCCESS: Job completed successfully
-- - JOB_EXECUTION_FAILURE: Job failed (non-retryable error)
-- - RETRY_SCHEDULED: Job failed but will be retried
-- ============================================================

BEGIN;

-- ============================================================
-- DROP OLD CHECK CONSTRAINT AND ADD NEW ONE
-- ============================================================

-- Drop the existing CHECK constraint on lifecycle_state
-- This constraint was too restrictive and didn't account for queue states
ALTER TABLE IF EXISTS mutation_lifecycle_events
DROP CONSTRAINT IF EXISTS mutation_lifecycle_events_lifecycle_state_check;

-- Add new CHECK constraint that includes queue-specific states
ALTER TABLE IF EXISTS mutation_lifecycle_events
ADD CONSTRAINT mutation_lifecycle_events_lifecycle_state_check
CHECK (
    lifecycle_state IN (
        -- Phase 1: Direct mutation flow (HTTP)
        'INTENT_RECEIVED',          -- Operator action received on client
        'MUTATION_DISPATCHED',      -- Request sent to API
        'API_ACCEPTED',             -- Server acknowledged receipt (202)
        'STATE_PERSISTED',          -- Database mutation committed
        'AUDIT_SNAPSHOTTED',        -- Audit snapshot captured
        'QUERY_INVALIDATED',        -- TanStack cache invalidation dispatched
        'CACHE_REFRESH_REQUESTED',  -- Refetch request initiated
        'QUERY_REFETCHED',          -- Fresh data received from server
        'UI_RECONCILED',            -- React component tree updated
        'OPERATOR_ACKNOWLEDGED',    -- Operator confirmed state change visible

        -- Phase 2A: Queue boundary (async)
        'QUEUE_ENQUEUED',           -- Job submitted to queue (producer)
        'JOB_EXECUTION_START',      -- Job dequeued and execution begins (consumer)
        'JOB_EXECUTION_SUCCESS',    -- Job completed successfully
        'JOB_EXECUTION_FAILURE',    -- Job failed (non-retryable error)
        'RETRY_SCHEDULED',          -- Job failed but will be retried

        -- Phase 2B: SSE Streaming boundary (SSE)
        'STREAM_BROADCAST_EMITTED', -- Server-sent event broadcast
        'CLIENT_STREAM_RECEIVED',   -- Client received stream update

        -- Cache management
        'CACHE_EVICTION_EMITTED'    -- Cache eviction event sent
    )
);

-- ============================================================
-- ADD DURATION COLUMN IF MISSING
-- ============================================================

ALTER TABLE IF EXISTS mutation_lifecycle_events
ADD COLUMN IF NOT EXISTS duration_in_state_ms INT;

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Verify lifecycle_state CHECK constraint is updated
-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_name = 'mutation_lifecycle_events'
-- AND constraint_type = 'CHECK';

-- Verify all required columns exist
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'mutation_lifecycle_events'
-- ORDER BY ordinal_position;
