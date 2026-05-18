-- ============================================================
-- Migration 104: Phase 2A Queue Boundary Schema Extension
-- ============================================================
-- Extends mutation_lifecycle_events with trace context for queue propagation
--
-- Adds W3C Trace Context columns (RFC 9110 compliant):
-- - trace_id: Distributed trace identifier (32 chars from traceparent)
-- - span_id: Execution span identifier (16 chars from traceparent)
-- - parent_span_id: Causal parent for retry chains and producer-consumer links
--
-- These columns are critical for verifying trace continuity across queue boundaries.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. TRACE CONTEXT COLUMNS (W3C RFC 9110)
-- ============================================================

ALTER TABLE IF EXISTS mutation_lifecycle_events
ADD COLUMN IF NOT EXISTS trace_id VARCHAR(32),
ADD COLUMN IF NOT EXISTS span_id VARCHAR(16),
ADD COLUMN IF NOT EXISTS parent_span_id VARCHAR(16);

-- Create index on trace_id for trace retrieval queries
CREATE INDEX IF NOT EXISTS idx_lifecycle_trace_id
ON mutation_lifecycle_events(trace_id);

-- Create index on span chain (parent-child relationships)
CREATE INDEX IF NOT EXISTS idx_lifecycle_span_parent
ON mutation_lifecycle_events(trace_id, parent_span_id);

-- ============================================================
-- 2. EXECUTION STATUS COLUMNS
-- ============================================================

ALTER TABLE IF EXISTS mutation_lifecycle_events
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'success'
  CHECK (status IN ('success', 'error', 'timeout', 'cancelled')),
ADD COLUMN IF NOT EXISTS execution_context VARCHAR(50)
  CHECK (execution_context IN ('PRODUCTION', 'SANDBOX', 'SIMULATION'));

-- ============================================================
-- 3. QUEUE-SPECIFIC METADATA
-- ============================================================

ALTER TABLE IF EXISTS mutation_lifecycle_events
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Index for metadata queries (idempotency keys, retry counts, topology)
CREATE INDEX IF NOT EXISTS idx_lifecycle_metadata
ON mutation_lifecycle_events USING gin(metadata);

-- ============================================================
-- 4. GOVERNANCE MUTATION JOURNAL (if not exists)
-- ============================================================

CREATE TABLE IF NOT EXISTS governance_mutation_journal (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id VARCHAR(32) NOT NULL,
    span_id VARCHAR(16),
    parent_span_id VARCHAR(16),
    correlation_id VARCHAR(64) NOT NULL,

    -- Mutation context
    index_name VARCHAR(128) NOT NULL,
    change_set JSONB NOT NULL,
    execution_class VARCHAR(50) NOT NULL CHECK (
        execution_class IN (
            'DIRECT_MUTATION',
            'CACHE_INVALIDATING',
            'STREAMING',
            'QUEUE_ASYNC'
        )
    ),

    -- Lifecycle
    mutation_state VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'success',
    duration_ms INT,

    -- Timestamps
    initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for mutation journal queries
CREATE INDEX IF NOT EXISTS idx_mutation_journal_trace_id
ON governance_mutation_journal(trace_id);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_correlation_id
ON governance_mutation_journal(correlation_id);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_index_name
ON governance_mutation_journal(index_name);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_recorded_at
ON governance_mutation_journal(recorded_at DESC);

-- ============================================================
-- 5. VALIDATION: Ensure core lifecycle columns still exist
-- ============================================================

-- Validate correlation_id exists (from migration 103)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mutation_lifecycle_events'
        AND column_name = 'correlation_id'
    ) THEN
        ALTER TABLE mutation_lifecycle_events
        ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64) NOT NULL DEFAULT 'unknown';
    END IF;
END $$;

-- Validate lifecycle_state exists (from migration 103)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mutation_lifecycle_events'
        AND column_name = 'lifecycle_state'
    ) THEN
        ALTER TABLE mutation_lifecycle_events
        ADD COLUMN IF NOT EXISTS lifecycle_state VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN';
    END IF;
END $$;

-- Validate recorded_at exists (from migration 103)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mutation_lifecycle_events'
        AND column_name = 'recorded_at'
    ) THEN
        ALTER TABLE mutation_lifecycle_events
        ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Verify mutation_lifecycle_events has all required columns
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'mutation_lifecycle_events'
-- ORDER BY ordinal_position;

-- Verify governance_mutation_journal was created
-- SELECT * FROM information_schema.tables
-- WHERE table_name = 'governance_mutation_journal';
