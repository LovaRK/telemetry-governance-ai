/**
 * GovernanceCausalityEngine
 *
 * Phase 6.1.5A.1: Trace Propagation Fabric
 * Core runtime for causal tracing with AsyncLocalStorage integration
 * Ensures unbroken context propagation across ALL async boundaries
 *
 * Key Principle:
 * "Trace context is not telemetry metadata — it is execution substrate.
 *  It must flow through every async boundary as automatically as call stacks do in synchronous code."
 */

import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import {
  TraceContext,
  TraceContextPayload,
  TraceContextWireFormat,
  TraceFlags,
  ExecutionContext,
  MutationLifecycleState,
  CoherenceTier,
  calculateCoherenceTier,
  getTraceContextOrNull,
  runWithTraceContextAsync,
  CreateChildSpanOptions,
  RecordSpanOptions,
} from '@/types/trace-context';

/**
 * Generates cryptographically-secure random hex string
 */
function generateHexId(length: number): string {
  return randomBytes(length / 2).toString('hex');
}

/**
 * W3C Trace Context standard trace ID format
 * 32 hex digits (128 bits), must not be all zeros
 */
function generateTraceId(): string {
  let id = generateHexId(32);
  while (id === '00000000000000000000000000000000') {
    id = generateHexId(32);
  }
  return id;
}

/**
 * W3C Trace Context standard span ID format
 * 16 hex digits (64 bits), must not be all zeros
 */
function generateSpanId(): string {
  let id = generateHexId(16);
  while (id === '0000000000000000') {
    id = generateHexId(16);
  }
  return id;
}

/**
 * Correlation ID format: corr_[timestamp]_[entropy]
 * User-facing, deterministic, and sortable
 */
function generateCorrelationId(): string {
  const timestamp = Date.now();
  const entropy = generateHexId(12);
  return `corr_${timestamp}_${entropy}`;
}

/**
 * Main causality engine: handles trace context lifecycle
 * Integrates with AsyncLocalStorage for automatic propagation
 */
export class GovernanceCausalityEngine {
  private pool: Pool;
  private saltCluster: string = this.generateMonthlySaltCluster();

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create new root trace context
   * Called at mutation origin (e.g., approve/reject decision)
   */
  createRootTraceContext(options?: {
    sessionId?: string;
    executionContext?: ExecutionContext;
    metadata?: Record<string, any>;
  }): TraceContext {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    const correlationId = generateCorrelationId();
    const now = performance.now();

    return {
      traceId,
      spanId,
      parentSpanId: null,
      traceFlags: { sampled: true, recorded: true },
      correlationId,
      sessionId: options?.sessionId,
      executionContext: options?.executionContext ?? 'PRODUCTION',
      metadata: options?.metadata ?? {},
      createdAt: now,
      parentCreatedAt: undefined,
    };
  }

  /**
   * Create child span from existing trace context
   * Used for nested async operations: retries, queue workers, SSE handlers, etc.
   */
  createChildSpan(
    parentContext: TraceContext,
    options?: CreateChildSpanOptions
  ): TraceContext {
    const childSpanId = generateSpanId();
    const now = performance.now();

    return {
      ...parentContext,
      spanId: childSpanId,
      parentSpanId: parentContext.spanId, // Link to parent
      parentCreatedAt: parentContext.createdAt,
      createdAt: now,
      retryCount: options?.retryAttempt ?? parentContext.retryCount ?? 0,
      retryParentSpanId:
        options?.retryAttempt !== undefined ? parentContext.spanId : undefined,
      metadata: {
        ...parentContext.metadata,
        ...options?.metadata,
        spanName: options?.spanName,
      },
    };
  }

  /**
   * Serialize trace context to W3C Trace Context format
   * Format: version-trace_id-parent_id-trace_flags
   */
  serializeTraceContextToWireFormat(context: TraceContext): TraceContextWireFormat {
    // W3C Trace Context: 00 (version) - traceId - spanId - traceFlags
    const traceFlags = (context.traceFlags.sampled ? 0x01 : 0x00) |
      (context.traceFlags.recorded ? 0x02 : 0x00);

    const traceparent =
      `00-${context.traceId}-${context.spanId}-${traceFlags.toString(16).padStart(2, '0')}`;

    // tracestate with Phase 6.1.5 extensions
    const tracestate = [
      `corr=${context.correlationId}`,
      context.executionContext !== 'PRODUCTION'
        ? `exec=${context.executionContext}`
        : null,
      context.retryCount !== undefined && context.retryCount > 0
        ? `retry=${context.retryCount}`
        : null,
    ]
      .filter(Boolean)
      .join(',');

    return { traceparent, tracestate };
  }

  /**
   * Deserialize W3C Trace Context format back to TraceContext
   * Handles both w3c traceparent header and vendor extensions in tracestate
   */
  deserializeTraceContextFromWireFormat(
    traceparent: string,
    tracestate?: string,
    sessionId?: string
  ): TraceContext | null {
    const parts = traceparent.split('-');
    if (parts.length !== 4) {
      console.warn(`Invalid traceparent format: ${traceparent}`);
      return null;
    }

    const [version, traceId, parentSpanId, traceFlagsByte] = parts;
    if (version !== '00') {
      console.warn(`Unsupported trace context version: ${version}`);
      return null;
    }

    const flags = parseInt(traceFlagsByte, 16);
    const sampled = (flags & 0x01) !== 0;
    const recorded = (flags & 0x02) !== 0;

    // Parse tracestate extensions
    let correlationId = `corr_${Date.now()}_${generateHexId(12)}`;
    let executionContext: ExecutionContext = 'PRODUCTION';
    let retryCount = 0;

    if (tracestate) {
      const pairs = tracestate.split(',');
      for (const pair of pairs) {
        const [key, value] = pair.trim().split('=');
        if (key === 'corr') correlationId = value;
        if (key === 'exec') executionContext = value as ExecutionContext;
        if (key === 'retry') retryCount = parseInt(value, 10);
      }
    }

    // Generate new span ID for this boundary crossing (don't reuse parent span)
    const spanId = generateSpanId();

    return {
      traceId,
      spanId,
      parentSpanId,
      traceFlags: { sampled, recorded },
      correlationId,
      sessionId,
      executionContext,
      metadata: {},
      createdAt: performance.now(),
      parentCreatedAt: undefined,
      retryCount,
    };
  }

  /**
   * Serialize trace context to queue/async envelope format
   * Used for: queue jobs, delayed operations, batch processors
   */
  serializeTraceContextToPayload(context: TraceContext): TraceContextPayload {
    return {
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      traceFlags: context.traceFlags,
      correlationId: context.correlationId,
      sessionId: context.sessionId,
      executionContext: context.executionContext,
      metadata: context.metadata,
      createdAt: context.createdAt,
      parentCreatedAt: context.parentCreatedAt,
      causalParentId: context.causalParentId,
      retryCount: context.retryCount,
      retryParentSpanId: context.retryParentSpanId,
    };
  }

  /**
   * Deserialize queue/async envelope payload back to TraceContext
   */
  deserializeTraceContextFromPayload(payload: TraceContextPayload): TraceContext {
    return {
      traceId: payload.traceId,
      spanId: payload.spanId,
      parentSpanId: payload.parentSpanId,
      traceFlags: payload.traceFlags,
      correlationId: payload.correlationId,
      sessionId: payload.sessionId,
      executionContext: payload.executionContext,
      metadata: payload.metadata,
      createdAt: payload.createdAt,
      parentCreatedAt: payload.parentCreatedAt,
      causalParentId: payload.causalParentId,
      retryCount: payload.retryCount,
      retryParentSpanId: payload.retryParentSpanId,
    };
  }

  /**
   * Record trace span completion to database
   * Called at each lifecycle boundary (mutation dispatch, API accept, DB commit, etc.)
   */
  async recordSpanEvent(
    trace: TraceContext,
    lifecycleState: MutationLifecycleState,
    options?: RecordSpanOptions & {
      indexName?: string;
      previousState?: MutationLifecycleState;
    }
  ): Promise<{ recorded: boolean; eventId?: string }> {
    if (trace.executionContext !== 'PRODUCTION') {
      // Divert simulation/sandbox to separate journal
      return this.recordSimulationSpanEvent(trace, lifecycleState, options);
    }

    const client = await this.pool.connect();
    try {
      const durationMs = options?.durationMs ?? performance.now() - trace.createdAt;
      const status = options?.status ?? 'success';

      const result = await client.query(
        `
        INSERT INTO mutation_lifecycle_events (
          trace_id,
          span_id,
          parent_span_id,
          correlation_id,
          lifecycle_state,
          previous_state,
          status,
          duration_in_state_ms,
          error_code,
          error_message,
          execution_context,
          recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING event_id
        `,
        [
          trace.traceId,
          trace.spanId,
          trace.parentSpanId,
          trace.correlationId,
          lifecycleState,
          options?.previousState ?? null,
          status,
          Math.round(durationMs),
          options?.errorCode ?? null,
          options?.errorMessage ?? null,
          trace.executionContext,
        ]
      );

      return { recorded: true, eventId: result.rows[0]?.event_id };
    } catch (error) {
      console.error('Failed to record span event:', error);
      return { recorded: false };
    } finally {
      client.release();
    }
  }

  /**
   * Record cache coherence metrics
   * Maps latency to coherence tier for automated decision-making
   */
  async recordCacheCoherenceMetrics(trace: TraceContext, metrics: {
    indexName: string;
    invalidationInitiatedMs: number;
    refetchCompletedMs: number;
    uiReconciliationMs?: number;
    staleRenderDurationMs?: number;
  }): Promise<{ recorded: boolean; coherenceId?: string; tier?: CoherenceTier }> {
    if (trace.executionContext !== 'PRODUCTION') {
      return { recorded: false }; // Don't pollute production metrics
    }

    const totalDivergenceWindowMs = metrics.uiReconciliationMs
      ? metrics.uiReconciliationMs - metrics.invalidationInitiatedMs
      : metrics.refetchCompletedMs - metrics.invalidationInitiatedMs;

    const tier = calculateCoherenceTier(totalDivergenceWindowMs);

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        INSERT INTO cache_coherence_telemetry (
          trace_id,
          correlation_id,
          index_name,
          invalidation_to_refetch_ms,
          refetch_to_ui_reconciliation_ms,
          total_divergence_window_ms,
          coherence_tier,
          stale_render_duration_ms,
          recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING coherence_id
        `,
        [
          trace.traceId,
          trace.correlationId,
          metrics.indexName,
          metrics.refetchCompletedMs - metrics.invalidationInitiatedMs,
          metrics.uiReconciliationMs ? metrics.uiReconciliationMs - metrics.refetchCompletedMs : 0,
          totalDivergenceWindowMs,
          tier,
          metrics.staleRenderDurationMs ?? null,
        ]
      );

      return { recorded: true, coherenceId: result.rows[0]?.coherence_id, tier };
    } catch (error) {
      console.error('Failed to record cache coherence metrics:', error);
      return { recorded: false };
    } finally {
      client.release();
    }
  }

  /**
   * Verify UI state matches authoritative backend
   * Used for STATE_VERIFIED lifecycle assertion (Phase 6.1.5)
   */
  async verifyTerminalState(trace: TraceContext, stateHash: {
    targetStateHash: string;
    actualStateHash: string;
  }): Promise<{ verified: boolean; mismatchReason?: string }> {
    if (stateHash.targetStateHash !== stateHash.actualStateHash) {
      return {
        verified: false,
        mismatchReason: `State hash mismatch: target=${stateHash.targetStateHash} actual=${stateHash.actualStateHash}`,
      };
    }

    const client = await this.pool.connect();
    try {
      await client.query(
        `
        INSERT INTO mutation_lifecycle_events (
          trace_id,
          span_id,
          parent_span_id,
          correlation_id,
          lifecycle_state,
          status,
          execution_context,
          metadata,
          recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        `,
        [
          trace.traceId,
          trace.spanId,
          trace.parentSpanId,
          trace.correlationId,
          'STATE_VERIFIED',
          'success',
          trace.executionContext,
          JSON.stringify({ targetStateHash: stateHash.targetStateHash }),
        ]
      );

      return { verified: true };
    } catch (error) {
      console.error('Failed to verify terminal state:', error);
      return { verified: false, mismatchReason: 'Database error' };
    } finally {
      client.release();
    }
  }

  /**
   * Query correlation chain: reconstruct full causal history from root to leaf
   */
  async getCorrelationChain(correlationId: string): Promise<TraceContext[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        WITH RECURSIVE chain AS (
          -- Root spans (no parent)
          SELECT trace_id, span_id, parent_span_id, correlation_id, created_at
          FROM mutation_lifecycle_events
          WHERE correlation_id = $1 AND parent_span_id IS NULL
          UNION ALL
          -- Recursive: descendants
          SELECT mle.trace_id, mle.span_id, mle.parent_span_id, mle.correlation_id, mle.created_at
          FROM mutation_lifecycle_events mle
          JOIN chain ON mle.parent_span_id = chain.span_id
        )
        SELECT DISTINCT trace_id, span_id, parent_span_id, correlation_id, created_at
        FROM chain
        ORDER BY created_at ASC
        `,
        [correlationId]
      );

      // Reconstruct minimal TraceContext objects from query results
      return result.rows.map((row) => ({
        traceId: row.trace_id,
        spanId: row.span_id,
        parentSpanId: row.parent_span_id,
        correlationId: row.correlation_id,
        traceFlags: { sampled: true, recorded: true },
        executionContext: 'PRODUCTION' as ExecutionContext,
        metadata: {},
        createdAt: row.created_at?.getTime() ?? 0,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * (Private) Divert simulation/sandbox spans to separate journal
   */
  private async recordSimulationSpanEvent(
    trace: TraceContext,
    lifecycleState: MutationLifecycleState,
    options?: RecordSpanOptions & { indexName?: string; previousState?: MutationLifecycleState }
  ): Promise<{ recorded: boolean; eventId?: string }> {
    const client = await this.pool.connect();
    try {
      const durationMs = options?.durationMs ?? performance.now() - trace.createdAt;

      const result = await client.query(
        `
        INSERT INTO governance_simulation_journal (
          trace_id,
          span_id,
          parent_span_id,
          correlation_id,
          lifecycle_state,
          execution_context,
          duration_in_state_ms,
          status,
          error_code,
          recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING simulation_id
        `,
        [
          trace.traceId,
          trace.spanId,
          trace.parentSpanId,
          trace.correlationId,
          lifecycleState,
          trace.executionContext,
          Math.round(durationMs),
          options?.status ?? 'success',
          options?.errorCode ?? null,
        ]
      );

      return { recorded: true, eventId: result.rows[0]?.simulation_id };
    } finally {
      client.release();
    }
  }

  /**
   * (Private) Generate monthly salt cluster for operator anonymization
   * Rotates on first of month
   */
  private generateMonthlySaltCluster(): string {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const hash = require('crypto')
      .createHash('sha256')
      .update(monthKey + 'governance_salt_constant')
      .digest('hex');
    return hash.substring(0, 16);
  }
}

/**
 * Singleton instance for dependency injection
 */
let governanceCausalityEngine: GovernanceCausalityEngine;

export function initializeGovernanceCausalityEngine(pool: Pool): GovernanceCausalityEngine {
  governanceCausalityEngine = new GovernanceCausalityEngine(pool);
  return governanceCausalityEngine;
}

export function getGovernanceCausalityEngine(): GovernanceCausalityEngine {
  if (!governanceCausalityEngine) {
    throw new Error('GovernanceCausalityEngine not initialized');
  }
  return governanceCausalityEngine;
}
