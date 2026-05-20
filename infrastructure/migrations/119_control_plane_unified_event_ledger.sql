-- Migration 119: Control Plane Unified Event Ledger
-- Establishes the canonical persistence layer for event-sourced operational governance
-- Per CONTROL_PLANE_EVENT_ARCHITECTURE specification
--
-- Core tables:
--  1. pipeline_executions — Master execution state machine (one per user action)
--  2. pipeline_events    — Unified immutable event log (many per execution)
--
-- This migration implements:
--  • Decoupled transport vs truth (DB is canonical)
--  • Execution-centric anchoring (execution_id as global address)
--  • Idempotency guarantees (UNIQUE on execution_id, sequence prevents duplicates)
--  • Taxonomy-based filtering (for compliance audit segmentation)
--  • Distributed replay capability (ordered sequence enables timeline reconstruction)

BEGIN;

-- ==============================================================================
-- 1. PIPELINE_EXECUTIONS: Master execution state machine
-- ==============================================================================
-- One record per user action (click remediation, trigger approval, etc.)
-- Tracks overall lifecycle: QUEUED -> PROCESSING -> DECISION_GATE -> EXECUTING -> COMPLETED
-- SSE uses this to bootstrap client state before event stream playback

CREATE TABLE IF NOT EXISTS pipeline_executions (
  id                    BIGSERIAL PRIMARY KEY,
  execution_id          UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  correlation_id        UUID NOT NULL,

  -- State machine boundary
  current_stage         VARCHAR(32) NOT NULL DEFAULT 'QUEUED'
    CHECK (current_stage IN (
      'QUEUED', 'PROCESSING', 'DECISION_GATE', 'EXECUTING',
      'COMPLETED', 'FAILED', 'CANCELLED'
    )),

  -- Agent decision context (optional; some executions are operator-initiated)
  agent_decision_id     BIGINT REFERENCES agent_decisions(id),

  -- Policy context
  policy_profile        VARCHAR(32),

  -- Idempotency & deduplication
  idempotency_key       UUID UNIQUE,  -- Client provides this; prevents duplicate submissions

  -- Timeline tracking
  started_at            TIMESTAMPTZ DEFAULT NOW(),
  decision_gate_at      TIMESTAMPTZ,
  execution_started_at  TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,

  -- Failure tracking (if any)
  failure_reason        TEXT,

  -- Metadata
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for pipeline_executions
CREATE INDEX idx_pipeline_exec_correlation ON pipeline_executions(correlation_id);
CREATE INDEX idx_pipeline_exec_decision ON pipeline_executions(agent_decision_id);
CREATE INDEX idx_pipeline_exec_stage ON pipeline_executions(current_stage);
CREATE INDEX idx_pipeline_exec_idempotency ON pipeline_executions(idempotency_key);
CREATE INDEX idx_pipeline_exec_created ON pipeline_executions(created_at DESC);

-- ==============================================================================
-- 2. PIPELINE_EVENTS: Unified immutable event ledger
-- ==============================================================================
-- The SINGLE source of truth for all operational mutations
-- Every step of the pipeline (policy eval, execution, reconciliation, etc.)
-- is captured as an immutable event in sequence order
--
-- Design principles:
--  • One table, many event types (taxonomy classification for filtering)
--  • Versioned schema (payload_version supports schema evolution)
--  • Idempotency guarantee (UNIQUE on execution_id, sequence prevents re-delivery duplicates)
--  • Rich metadata (correlation_id, actor, timestamp for distributed tracing)
--  • Deterministic ordering (sequence + timestamp enables replay)

CREATE TABLE IF NOT EXISTS pipeline_events (
  id                    BIGSERIAL PRIMARY KEY,

  -- Event identity & ordering
  event_id              VARCHAR(64) NOT NULL UNIQUE,  -- evt_01HNJ62X49MKPZ4ZWRK2387X1V format
  execution_id          UUID NOT NULL,                -- Global execution anchor
  sequence              INT NOT NULL,                 -- Monotonic sequence within execution

  -- Distributed tracing
  correlation_id        UUID NOT NULL,                -- W3C Trace Context parent
  trace_parent          VARCHAR(255),                 -- W3C traceparent header (for OpenTelemetry)

  -- Actor & session context
  actor                 VARCHAR(128),                 -- agent:cost_optimization, operator:alice, system
  operator_session_id   VARCHAR(255),                 -- Operator identity (can be anonymized later)

  -- Event classification for querying and filtering
  event_type            VARCHAR(64) NOT NULL,         -- POLICY_VALIDATION_EXECUTED, AGENT_REASONING_CONCLUDED, etc.
  taxonomy              VARCHAR(32) NOT NULL,         -- AGENT, POLICY, GOVERNANCE, ROLLBACK, PIPELINE, SYSTEM, QUEUE, AUTH, OPERATOR
  severity              VARCHAR(16) NOT NULL DEFAULT 'INFO'
    CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),

  -- Human-readable message
  message               TEXT NOT NULL,

  -- Event-specific payload (versioned for schema evolution)
  payload               JSONB NOT NULL DEFAULT '{}',
  payload_version       VARCHAR(16) DEFAULT '1.0',

  -- Governance metadata (policy decisions, rollback info, etc.)
  governance            JSONB DEFAULT '{}',
  -- Structure:
  -- {
  --   "matched_policies": ["DROP_PROD_SPANS"],
  --   "requires_approval": true,
  --   "rollback_available": true,
  --   "rollback_metadata": {
  --     "recovery_mechanism": "GITOPS_WEBHOOK",
  --     "estimated_recovery_time_secs": 120
  --   }
  -- }

  -- Event timestamps (for timeline reconstruction)
  timestamp             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: prevent idempotent re-delivery from creating duplicates
  UNIQUE (execution_id, sequence),
  UNIQUE (execution_id, event_id)
);

-- Create indexes for pipeline_events
CREATE INDEX idx_pipeline_event_execution ON pipeline_events(execution_id, sequence);
CREATE INDEX idx_pipeline_event_correlation ON pipeline_events(correlation_id);
CREATE INDEX idx_pipeline_event_taxonomy ON pipeline_events(taxonomy);
CREATE INDEX idx_pipeline_event_type ON pipeline_events(event_type);
CREATE INDEX idx_pipeline_event_timestamp ON pipeline_events(timestamp DESC);
CREATE INDEX idx_pipeline_event_created ON pipeline_events(created_at DESC);
CREATE INDEX idx_pipeline_event_actor ON pipeline_events(actor);
CREATE INDEX idx_pipeline_event_session ON pipeline_events(operator_session_id);

-- ==============================================================================
-- 3. FOREIGN KEY CONSTRAINTS
-- ==============================================================================
ALTER TABLE pipeline_events
  ADD CONSTRAINT fk_pipeline_event_execution
  FOREIGN KEY (execution_id)
  REFERENCES pipeline_executions(execution_id) ON DELETE CASCADE;

-- ==============================================================================
-- 4. VIEW: Event Timeline Reconstruction
-- ==============================================================================
-- Allows replaying execution state by aggregating events in sequence order
-- Used by dashboard timeline UI and audit trail replay endpoint

CREATE OR REPLACE VIEW pipeline_event_timeline AS
SELECT
  pe.execution_id,
  pe.sequence,
  pe.event_type,
  pe.taxonomy,
  pe.severity,
  pe.message,
  pe.actor,
  pe.timestamp,
  pe.payload,
  pe.governance,
  exec.current_stage,
  exec.agent_decision_id
FROM pipeline_events pe
JOIN pipeline_executions exec ON pe.execution_id = exec.execution_id
ORDER BY pe.execution_id, pe.sequence ASC;

-- ==============================================================================
-- 5. INDEXES FOR PERFORMANCE CRITICAL QUERIES
-- ==============================================================================

-- Composite indexes for common access patterns
CREATE INDEX idx_pipeline_event_recent ON pipeline_events(created_at DESC, taxonomy);
CREATE INDEX idx_pipeline_event_operator_timeline ON pipeline_events(operator_session_id, created_at DESC);
CREATE INDEX idx_pipeline_event_policy_recent ON pipeline_events(taxonomy, timestamp DESC) WHERE taxonomy = 'POLICY';

-- ==============================================================================
-- 6. HELPER FUNCTION: Generate Event ID (Ulid-style)
-- ==============================================================================
-- Used by application layer to create deterministic event_id values
-- Format: evt_01HNJ62X49MKPZ4ZWRK2387X1V (PostgreSQL-compatible)

CREATE OR REPLACE FUNCTION generate_event_id()
  RETURNS VARCHAR(64)
AS $$
BEGIN
  RETURN 'evt_' || SUBSTR(gen_random_uuid()::text, 1, 12) ||
         SUBSTR(gen_random_uuid()::text, 1, 16);
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 7. AUDIT TRAIL HELPER VIEW
-- ==============================================================================
-- Shows human-readable decision timeline with all policy gates and approvals

CREATE OR REPLACE VIEW decision_audit_trail AS
SELECT
  pe.execution_id,
  pe.timestamp,
  exec.agent_decision_id,
  pe.event_type,
  pe.taxonomy,
  pe.actor,
  pe.message,
  CASE
    WHEN pe.governance @> '{"requires_approval": true}' THEN 'REQUIRES_APPROVAL'
    WHEN pe.governance @> '{"matched_policies": []}' THEN 'POLICY_PASSED'
    ELSE pe.severity
  END AS decision,
  pe.payload
FROM pipeline_events pe
JOIN pipeline_executions exec ON pe.execution_id = exec.execution_id
WHERE pe.taxonomy IN ('POLICY', 'GOVERNANCE', 'AGENT')
ORDER BY pe.execution_id, pe.sequence ASC;

-- ==============================================================================
-- 8. VERIFICATION TRIGGERS (Optional: for data quality enforcement)
-- ==============================================================================
-- Ensures sequence numbers are monotonically increasing within execution

CREATE OR REPLACE FUNCTION validate_event_sequence()
  RETURNS TRIGGER
AS $$
DECLARE
  max_seq INT;
BEGIN
  -- Get the max sequence for this execution (excluding current row if update)
  SELECT COALESCE(MAX(sequence), -1) INTO max_seq
  FROM pipeline_events
  WHERE execution_id = NEW.execution_id
    AND id != COALESCE(OLD.id, -1);

  -- New sequence must be > previous max
  IF NEW.sequence <= max_seq THEN
    RAISE EXCEPTION 'Event sequence must be monotonically increasing (last=%, new=%)', max_seq, NEW.sequence;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_event_sequence
  BEFORE INSERT OR UPDATE ON pipeline_events
  FOR EACH ROW
  EXECUTE FUNCTION validate_event_sequence();

COMMIT;
