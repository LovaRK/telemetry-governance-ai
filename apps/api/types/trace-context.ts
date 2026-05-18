/**
 * TraceContext Interface Definition
 *
 * Phase 6.1.5: Trace Propagation Fabric
 * W3C Trace Context standard with Phase 6.1.5 extensions
 * Ensures unbroken causal linkage across all async boundaries
 *
 * Specification:
 * - traceparent: W3C standard header format: version-trace_id-parent_id-trace_flags
 * - tracestate: W3C standard for vendor-specific extensions
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Execution context mode for isolation boundaries
 * Prevents simulation/sandbox test data from corrupting production metrics
 */
export type ExecutionContext = 'PRODUCTION' | 'SANDBOX' | 'SIMULATION' | 'REPLAY' | 'TESTING';

/**
 * Trace flags for propagation control
 */
export interface TraceFlags {
  sampled: boolean; // 0x01 bit
  recorded: boolean; // Custom: whether to persist to observability backend
}

/**
 * Core trace context container
 * Represents single point-in-time state of trace propagation
 */
export interface TraceContext {
  // W3C Trace Context Standard
  traceId: string; // 32 hex digits, globally unique
  spanId: string; // 16 hex digits, unique within trace
  parentSpanId: string | null; // null for root span
  traceFlags: TraceFlags;

  // Phase 6.1.5 Extensions
  correlationId: string; // corr_[timestamp]_[entropy], user-facing
  sessionId?: string; // Operator session ID from Phase 5.2
  executionContext: ExecutionContext; // Isolation boundary
  metadata: Record<string, any>; // Custom telemetry fields

  // Timestamps (for coherence calculation)
  createdAt: number; // performance.now() or Date.getTime()
  parentCreatedAt?: number; // For calculating span duration

  // Parent chain (for deep causality)
  causalParentId?: string; // Explicit dependency from prior mutation
  retryCount?: number; // Number of times this span has been retried
  retryParentSpanId?: string; // Previous attempt's spanId if retried
}

/**
 * Serialization format for wire transmission (HTTP headers, queue messages)
 * Follows W3C Trace Context spec: version-trace_id-parent_id-trace_flags
 * Extends with vendor extensions in tracestate header
 */
export interface TraceContextWireFormat {
  traceparent: string; // W3C standard: 00-traceId-parentSpanId-traceFlags
  tracestate: string; // W3C standard vendor extensions
}

/**
 * Payload format for queue envelopes and async serialization
 * Includes all context needed to reconstruct TraceContext on deserialization
 */
export interface TraceContextPayload {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceFlags: TraceFlags;
  correlationId: string;
  sessionId?: string;
  executionContext: ExecutionContext;
  metadata: Record<string, any>;
  createdAt: number;
  parentCreatedAt?: number;
  causalParentId?: string;
  retryCount?: number;
  retryParentSpanId?: string;
}

/**
 * Options for creating child spans
 */
export interface CreateChildSpanOptions {
  spanName?: string; // Human-readable span label
  parentSpanId?: string; // Override parent (for explicit parent linkage)
  retryAttempt?: number; // For retry chains
  metadata?: Record<string, any>; // Merge with parent metadata
}

/**
 * Options for recording span completion
 */
export interface RecordSpanOptions {
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number; // Auto-calculated if not provided
}

/**
 * Global AsyncLocalStorage for automatic context propagation
 * Ensures trace context flows through:
 * - Promise chains
 * - async/await
 * - TanStack Query callbacks
 * - Queue worker callbacks
 * - SSE event handlers
 * - Retry handlers
 * - Database transaction callbacks
 *
 * WITHOUT requiring manual context threading
 */
export const traceContextAsyncLocalStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Type-safe trace context accessor
 * Returns current context or throws if outside trace boundary
 */
export function getTraceContext(): TraceContext {
  const context = traceContextAsyncLocalStorage.getStore();
  if (!context) {
    throw new Error(
      'getTraceContext() called outside trace boundary. ' +
        'Ensure all async work runs within TraceContext.run() or equivalent.'
    );
  }
  return context;
}

/**
 * Type-safe trace context accessor (nullable)
 * Returns current context or null if outside trace boundary
 */
export function getTraceContextOrNull(): TraceContext | null {
  return traceContextAsyncLocalStorage.getStore() ?? null;
}

/**
 * Run callback within trace context
 * Ensures all async operations within callback inherit context
 */
export function runWithTraceContext<T>(context: TraceContext, callback: () => T): T {
  return traceContextAsyncLocalStorage.run(context, callback);
}

/**
 * Run async callback within trace context
 * Ensures all async operations (promises, async/await) inherit context
 */
export async function runWithTraceContextAsync<T>(
  context: TraceContext,
  callback: () => Promise<T>
): Promise<T> {
  return traceContextAsyncLocalStorage.run(context, callback);
}

/**
 * Coherence tier classification
 * Maps cache invalidation latency to automation thresholds
 */
export type CoherenceTier = 'NOMINAL' | 'DEGRADED' | 'STALE' | 'SEVERE';

export interface CoherenceTierThresholds {
  NOMINAL: { maxMs: 500 };
  DEGRADED: { maxMs: 3000 };
  STALE: { maxMs: 15000 };
  SEVERE: { minMs: 15001 };
}

/**
 * Calculate coherence tier from latency milliseconds
 */
export function calculateCoherenceTier(latencyMs: number): CoherenceTier {
  if (latencyMs <= 500) return 'NOMINAL';
  if (latencyMs <= 3000) return 'DEGRADED';
  if (latencyMs <= 15000) return 'STALE';
  return 'SEVERE';
}

/**
 * Mutation lifecycle states (Phase 6.1 extended)
 * 10-stage progression from user intent to UI acknowledgment
 */
export type MutationLifecycleState =
  | 'INTENT_RECEIVED' // User initiated action
  | 'MUTATION_DISPATCHED' // Mutation sent to API
  | 'API_ACCEPTED' // Server received mutation
  | 'STATE_PERSISTED' // Database write committed
  | 'AUDIT_SNAPSHOTTED' // Governance audit snapshot captured
  | 'QUERY_INVALIDATED' // TanStack Query cache invalidated
  | 'CACHE_REFRESH_REQUESTED' // Refetch initiated
  | 'QUERY_REFETCHED' // Fresh data received from server
  | 'UI_RECONCILED' // React render completed
  | 'STATE_VERIFIED'; // UI state matches authoritative backend (NEW in Phase 6.1.5)

/**
 * Execution path through trace tree
 * Used to isolate replay/simulation from production
 */
export interface ExecutionPath {
  operationType: 'mutation' | 'query' | 'replay' | 'simulation';
  indexName: string;
  executionContext: ExecutionContext;
  startedAt: Date;
  completedAt?: Date;
}
