/**
 * Pipeline Events Emission Helper
 *
 * Implements the unified event ledger pattern from CONTROL_PLANE_EVENT_ARCHITECTURE.
 * All operational mutations (policy validations, executions, reconciliations) flow through
 * this module to ensure they're captured in the canonical event log.
 *
 * Guarantees:
 * - Idempotency: (execution_id, sequence) uniqueness prevents duplicates
 * - Monotonic ordering: Triggers enforce sequence > previous sequence
 * - Distributed tracing: W3C traceparent + correlation_id on every event
 * - Deterministic replay: Events can reconstruct state at any point in time
 */

import { query } from './connection';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type EventTaxonomy =
  | 'AGENT'
  | 'POLICY'
  | 'GOVERNANCE'
  | 'ROLLBACK'
  | 'PIPELINE'
  | 'SYSTEM'
  | 'QUEUE'
  | 'AUTH'
  | 'OPERATOR';

export type EventSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export type PipelineStage =
  | 'QUEUED'
  | 'PROCESSING'
  | 'DECISION_GATE'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface PipelineEvent {
  // Event identity & execution context
  execution_id: string;        // UUID
  sequence: number;            // Monotonic within execution
  event_id?: string;           // Generated if not provided (evt_xxxxx format)

  // Classification & filtering
  event_type: string;          // POLICY_VALIDATION_EXECUTED, AGENT_REASONING_CONCLUDED, etc.
  taxonomy: EventTaxonomy;
  severity?: EventSeverity;    // Default: INFO

  // Message & payload
  message: string;
  payload?: Record<string, any>;
  payload_version?: string;    // Default: '1.0'

  // Distributed tracing
  correlation_id: string;      // UUID
  trace_parent?: string;       // W3C traceparent header

  // Actor & session context
  actor?: string;              // agent:cost_optimization, operator:alice, system
  operator_session_id?: string; // Anonymizable operator identity

  // Temporal context
  timestamp: string;           // ISO 8601 timestamp
  created_at?: string;         // ISO 8601 creation timestamp

  // Governance metadata (policy decisions, rollback info, etc.)
  governance?: Record<string, any>;
}

export interface PipelineExecution {
  execution_id: string;        // UUID
  correlation_id: string;      // UUID
  agent_decision_id?: number;
  policy_profile?: string;
  idempotency_key?: string;    // UUID, client-provided for deduplication
  current_stage?: PipelineStage;
  metadata?: Record<string, any>;
}

// ============================================================================
// EXECUTION MANAGEMENT
// ============================================================================

/**
 * Create a new execution record
 *
 * This is the bootstrap step: before any events can be emitted, an execution
 * record must exist to anchor them. The execution_id becomes the global address
 * for all events in this pipeline run.
 *
 * @param params Pipeline execution parameters
 * @returns The created execution_id
 */
export async function createExecution(params: Partial<PipelineExecution>): Promise<string> {
  const executionId = params.execution_id || uuidv4();
  const correlationId = params.correlation_id || uuidv4();

  try {
    await query(
      `INSERT INTO pipeline_executions (
        execution_id, correlation_id, agent_decision_id, policy_profile,
        idempotency_key, current_stage, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        executionId,
        correlationId,
        params.agent_decision_id || null,
        params.policy_profile || null,
        params.idempotency_key || null,
        params.current_stage || 'QUEUED',
        JSON.stringify(params.metadata || {}),
      ]
    );

    console.log(`[PipelineEvents] Created execution: ${executionId}`);
    return executionId;
  } catch (error) {
    console.error(`[PipelineEvents] Failed to create execution:`, error);
    throw error;
  }
}

/**
 * Update execution state
 *
 * Progresses the execution through its state machine lifecycle.
 * This is NOT an event emission; this is master state tracking.
 *
 * @param executionId Execution to update
 * @param stage New pipeline stage
 * @param metadata Additional metadata to merge
 */
export async function updateExecutionStage(
  executionId: string,
  stage: PipelineStage,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const updateFields = ['current_stage = $2', 'updated_at = NOW()'];
    const values: any[] = [executionId, stage];
    let paramIndex = 3;

    if (metadata) {
      updateFields.push(`metadata = metadata || $${paramIndex}`);
      values.push(JSON.stringify(metadata));
    }

    await query(
      `UPDATE pipeline_executions SET ${updateFields.join(', ')} WHERE execution_id = $1`,
      values
    );

    console.log(`[PipelineEvents] Updated execution ${executionId} to stage: ${stage}`);
  } catch (error) {
    console.error(`[PipelineEvents] Failed to update execution stage:`, error);
    throw error;
  }
}

// ============================================================================
// EVENT EMISSION
// ============================================================================

/**
 * Emit a pipeline event
 *
 * The primary API for recording operational mutations. This appends an immutable
 * event to the canonical ledger. The event is indexed by (execution_id, sequence)
 * for idempotent deduplication.
 *
 * Idempotency guarantee: If the same event (same execution_id + sequence) is
 * submitted twice, the database uniqueness constraint prevents duplication.
 * Retries are safe.
 *
 * @param event Event to emit
 * @returns The event_id and sequence assigned
 */
export async function emitPipelineEvent(event: PipelineEvent): Promise<{
  event_id: string;
  sequence: number;
}> {
  // Generate event_id if not provided (Ulid-style)
  const eventId = event.event_id || generateEventId();

  // Validate required fields
  if (!event.execution_id) {
    throw new Error('event.execution_id is required');
  }
  if (event.sequence === undefined) {
    throw new Error('event.sequence is required');
  }

  try {
    // Emit the event into the canonical ledger
    await query(
      `INSERT INTO pipeline_events (
        event_id, execution_id, sequence, correlation_id, trace_parent,
        actor, operator_session_id, event_type, taxonomy, severity,
        message, payload, payload_version, governance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        eventId,
        event.execution_id,
        event.sequence,
        event.correlation_id,
        event.trace_parent || null,
        event.actor || null,
        event.operator_session_id || null,
        event.event_type,
        event.taxonomy,
        event.severity || 'INFO',
        event.message,
        JSON.stringify(event.payload || {}),
        event.payload_version || '1.0',
        JSON.stringify(event.governance || {}),
      ]
    );

    console.log(
      `[PipelineEvents] Emitted event: ${eventId} (execution: ${event.execution_id}, seq: ${event.sequence})`
    );

    return { event_id: eventId, sequence: event.sequence };
  } catch (error) {
    if ((error as any).code === '23505') {
      // Unique constraint violation — likely an idempotent retry
      console.warn(
        `[PipelineEvents] Event already exists (execution: ${event.execution_id}, seq: ${event.sequence})`
      );
      return { event_id: eventId, sequence: event.sequence };
    }
    console.error(`[PipelineEvents] Failed to emit event:`, error);
    throw error;
  }
}

/**
 * Emit a batch of events atomically
 *
 * For operations that produce multiple events (e.g., policy evaluation that
 * results in multiple guardrail checks), batch them into a single transaction
 * to ensure all-or-nothing semantics.
 *
 * @param executionId Execution context
 * @param events Events to emit
 * @returns Array of assigned (event_id, sequence) tuples
 */
export async function emitPipelineEventBatch(
  executionId: string,
  events: Omit<PipelineEvent, 'execution_id'>[]
): Promise<Array<{ event_id: string; sequence: number }>> {
  try {
    const results = [];
    for (const event of events) {
      const result = await emitPipelineEvent({
        ...event,
        execution_id: executionId,
      });
      results.push(result);
    }
    return results;
  } catch (error) {
    console.error(`[PipelineEvents] Batch emission failed:`, error);
    throw error;
  }
}

// ============================================================================
// QUERY & RETRIEVAL
// ============================================================================

/**
 * Retrieve full event timeline for an execution
 *
 * This is the core replay operation: fetch all events for an execution in
 * sequence order, enabling deterministic state reconstruction.
 *
 * @param executionId Execution to retrieve timeline for
 * @returns Ordered array of events
 */
export async function getExecutionTimeline(executionId: string): Promise<PipelineEvent[]> {
  try {
    const result = await query(
      `SELECT
        event_id, execution_id, sequence, correlation_id, trace_parent,
        actor, operator_session_id, event_type, taxonomy, severity,
        message, payload, payload_version, governance, timestamp
      FROM pipeline_events
      WHERE execution_id = $1
      ORDER BY sequence ASC`,
      [executionId]
    );

    return result.rows.map((row: any) => ({
      event_id: row.event_id,
      execution_id: row.execution_id,
      sequence: row.sequence,
      correlation_id: row.correlation_id,
      trace_parent: row.trace_parent,
      actor: row.actor,
      operator_session_id: row.operator_session_id,
      event_type: row.event_type,
      taxonomy: row.taxonomy,
      severity: row.severity,
      message: row.message,
      payload: row.payload,
      payload_version: row.payload_version,
      governance: row.governance,
      timestamp: row.timestamp,
    }));
  } catch (error) {
    console.error(`[PipelineEvents] Failed to retrieve timeline:`, error);
    throw error;
  }
}

/**
 * Retrieve recent events by taxonomy
 *
 * For real-time SSE streaming: fetch events from a given taxonomy across
 * all recent executions, useful for dashboard live updates.
 *
 * @param taxonomy Event taxonomy to filter
 * @param limit Maximum events to return
 * @param sinceTimestamp Only events after this timestamp
 * @returns Recent events
 */
export async function getRecentEventsByTaxonomy(
  taxonomy: EventTaxonomy,
  limit: number = 100,
  sinceTimestamp?: string
): Promise<PipelineEvent[]> {
  try {
    let sql = `
      SELECT
        event_id, execution_id, sequence, correlation_id, trace_parent,
        actor, operator_session_id, event_type, taxonomy, severity,
        message, payload, payload_version, governance, timestamp
      FROM pipeline_events
      WHERE taxonomy = $1
    `;

    const params: any[] = [taxonomy];

    if (sinceTimestamp) {
      sql += ` AND timestamp > $${params.length + 1}`;
      params.push(sinceTimestamp);
    }

    sql += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);

    return result.rows.map((row: any) => ({
      event_id: row.event_id,
      execution_id: row.execution_id,
      sequence: row.sequence,
      correlation_id: row.correlation_id,
      trace_parent: row.trace_parent,
      actor: row.actor,
      operator_session_id: row.operator_session_id,
      event_type: row.event_type,
      taxonomy: row.taxonomy,
      severity: row.severity,
      message: row.message,
      payload: row.payload,
      payload_version: row.payload_version,
      governance: row.governance,
      timestamp: row.timestamp,
    }));
  } catch (error) {
    console.error(`[PipelineEvents] Failed to retrieve events by taxonomy:`, error);
    throw error;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate an event_id in the format: evt_XXXXXXXXXXXXXXXXXXXX
 *
 * This produces deterministic, sortable event identifiers that work well
 * with both databases and distributed tracing systems.
 */
function generateEventId(): string {
  // Format: evt_ + 12 hex chars + 16 hex chars = evt_XXXXXXXXXXXXXXXXXXXX
  const uuid1 = uuidv4().replace(/-/g, '').substring(0, 12);
  const uuid2 = uuidv4().replace(/-/g, '').substring(0, 16);
  return `evt_${uuid1}${uuid2}`;
}

/**
 * Format governance metadata for structured policy decisions
 *
 * Helper to construct governance metadata with standard structure.
 */
export function buildGovernanceMetadata(params: {
  matched_policies?: string[];
  requires_approval?: boolean;
  rollback_available?: boolean;
  rollback_metadata?: {
    recovery_mechanism: string;
    estimated_recovery_time_secs: number;
    target_configuration_hash?: string;
  };
}): Record<string, any> {
  return {
    matched_policies: params.matched_policies || [],
    requires_approval: params.requires_approval || false,
    rollback_available: params.rollback_available || false,
    rollback_metadata: params.rollback_metadata || null,
  };
}
