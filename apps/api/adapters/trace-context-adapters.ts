/**
 * Trace Context Adapters
 *
 * Phase 6.1.5A: Propagation across async boundaries
 * Adapters for queue jobs, SSE streams, TanStack Query, and HTTP fetch
 * Each adapter serializes trace context at boundary crossing and deserializes on the other side
 *
 * Principle: Use adapters/middleware, NOT manual context threading in components
 */

import {
  TraceContext,
  TraceContextPayload,
  TraceContextWireFormat,
  getTraceContextOrNull,
  runWithTraceContextAsync,
  ExecutionContext,
} from '@/types/trace-context';
import { GovernanceCausalityEngine } from '@/services/governance-causality-engine';

/**
 * QUEUE JOB ENVELOPE
 * ==================
 * Wraps any job payload with trace context for worker deserialization
 */

export interface QueueJobEnvelope<T> {
  // Job payload
  payload: T;

  // Trace propagation
  traceContext: TraceContextPayload;

  // Metadata
  enqueuedAt: number;
  jobId: string;
  retryCount: number;
}

/**
 * Enqueue task with automatic trace context injection
 * Called from mutation handlers to publish work to queue
 */
export async function enqueueTaskWithTrace<T>(
  queueName: string,
  payload: T,
  engine: GovernanceCausalityEngine,
  options?: {
    delayMs?: number;
    priority?: 'high' | 'normal' | 'low';
  }
): Promise<QueueJobEnvelope<T>> {
  const parentContext = getTraceContextOrNull();
  if (!parentContext) {
    throw new Error(
      `enqueueTaskWithTrace called without parent trace context. ` +
        `Ensure mutation runs within trace boundary.`
    );
  }

  const childContext = engine.createChildSpan(parentContext, {
    spanName: `queue:${queueName}`,
  });

  const envelope: QueueJobEnvelope<T> = {
    payload,
    traceContext: engine.serializeTraceContextToPayload(childContext),
    enqueuedAt: performance.now(),
    jobId: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    retryCount: 0,
  };

  // TODO: Actual queue publish (e.g., to Bull, RabbitMQ, etc.)
  // await queue.add(queueName, envelope, { delay: options?.delayMs, priority: options?.priority });

  return envelope;
}

/**
 * Process incoming queue job with automatic trace context restoration
 * Called from worker consumer
 */
export async function processQueueJobWithTrace<T, R>(
  envelope: QueueJobEnvelope<T>,
  workerFn: (payload: T, context: TraceContext) => Promise<R>,
  engine: GovernanceCausalityEngine
): Promise<R> {
  const parentContext = engine.deserializeTraceContextFromPayload(envelope.traceContext);
  const childContext = engine.createChildSpan(parentContext, {
    spanName: 'worker:process',
  });

  return runWithTraceContextAsync(childContext, async () => {
    try {
      const result = await workerFn(envelope.payload, childContext);

      await engine.recordSpanEvent(childContext, 'QUERY_REFETCHED', {
        status: 'success',
      });

      return result;
    } catch (error) {
      await engine.recordSpanEvent(childContext, 'QUERY_REFETCHED', {
        status: 'error',
        errorCode: (error as any)?.code ?? 'UNKNOWN',
        errorMessage: (error as Error)?.message,
      });
      throw error;
    }
  });
}

/**
 * SSE STREAM INJECTION
 * ====================
 * Ensures every SSE event carries trace metadata for client reconstruction
 */

export interface SSEEventWithTrace<T> {
  // Event payload
  event: string;
  data: T;

  // Trace propagation
  traceContext: TraceContextPayload;
  parentTraceId: string;

  // Metadata
  sentAt: number;
  eventSequence: number;
}

/**
 * Send SSE event with automatic trace context injection
 * Called from server-sent event handler
 */
export function createSSEEventWithTrace<T>(
  event: string,
  data: T,
  engine: GovernanceCausalityEngine,
  eventSequence: number = 0
): SSEEventWithTrace<T> {
  const parentContext = getTraceContextOrNull();
  if (!parentContext) {
    throw new Error('createSSEEventWithTrace called without parent trace context');
  }

  return {
    event,
    data,
    traceContext: engine.serializeTraceContextToPayload(parentContext),
    parentTraceId: parentContext.traceId,
    sentAt: performance.now(),
    eventSequence,
  };
}

/**
 * Format SSE event for wire transmission
 * Embeds trace context as event comment for client-side extraction
 */
export function formatSSEEventForTransmission<T>(
  sseEvent: SSEEventWithTrace<T>
): string {
  const lines: string[] = [];

  // Trace context as comment (not visible to client but serialized)
  lines.push(`: trace=${JSON.stringify(sseEvent.traceContext)}`);
  lines.push(`event: ${sseEvent.event}`);
  lines.push(`data: ${JSON.stringify(sseEvent.data)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Extract SSE event trace context on client side
 * Called from browser-side SSE event listener
 */
export function extractTraceContextFromSSEEvent(
  rawEventString: string,
  engine: GovernanceCausalityEngine
): { data: any; traceContext?: TraceContext } {
  const lines = rawEventString.trim().split('\n');
  let traceContextPayload: TraceContextPayload | null = null;
  let eventData: any = null;

  for (const line of lines) {
    if (line.startsWith(': trace=')) {
      const jsonStr = line.substring(': trace='.length);
      traceContextPayload = JSON.parse(jsonStr);
    } else if (line.startsWith('data: ')) {
      const jsonStr = line.substring('data: '.length);
      eventData = JSON.parse(jsonStr);
    }
  }

  const traceContext = traceContextPayload
    ? engine.deserializeTraceContextFromPayload(traceContextPayload)
    : undefined;

  return { data: eventData, traceContext };
}

/**
 * FETCH WRAPPER
 * =============
 * Injects trace context into HTTP headers for server propagation
 */

/**
 * Fetch wrapper with automatic trace context injection into headers
 * Used in frontend for all API calls from mutations/queries
 */
export async function fetchWithTrace(
  url: string,
  options?: RequestInit & { traceContext?: TraceContext }
): Promise<Response> {
  const traceContext = options?.traceContext ?? getTraceContextOrNull();

  const headers = new Headers(options?.headers ?? {});

  if (traceContext) {
    const wireFormat = new GovernanceCausalityEngine(null as any).serializeTraceContextToWireFormat(
      traceContext
    );
    headers.set('traceparent', wireFormat.traceparent);
    if (wireFormat.tracestate) {
      headers.set('tracestate', wireFormat.tracestate);
    }
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * TANSTACK QUERY WRAPPER
 * ======================
 * Attaches trace context to query metadata for cache coherence tracking
 */

export interface QueryMetaWithTrace {
  correlationId: string;
  traceId: string;
  spanId: string;
  coherenceEnabled: boolean;
}

/**
 * Wrap TanStack Query with trace context injection
 * Automatically propagates trace through query cache
 */
export function withQueryTrace(
  queryKey: any[],
  options?: {
    staleTime?: number;
    gcTime?: number;
    traceContext?: TraceContext;
  }
): {
  queryKey: any[];
  meta: QueryMetaWithTrace;
  staleTime?: number;
  gcTime?: number;
} {
  const traceContext = options?.traceContext ?? getTraceContextOrNull();

  return {
    queryKey,
    meta: {
      correlationId: traceContext?.correlationId ?? 'unknown',
      traceId: traceContext?.traceId ?? 'unknown',
      spanId: traceContext?.spanId ?? 'unknown',
      coherenceEnabled: true,
    },
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  };
}

/**
 * RETRY HANDLER WRAPPER
 * =====================
 * Maintains trace context across retry chains
 */

export async function executeWithRetryTrace<T>(
  operation: (attempt: number) => Promise<T>,
  engine: GovernanceCausalityEngine,
  options?: {
    maxRetries?: number;
    backoffMs?: number;
  }
): Promise<T> {
  const parentContext = getTraceContextOrNull();
  if (!parentContext) {
    throw new Error('executeWithRetryTrace called without parent trace context');
  }

  const maxRetries = options?.maxRetries ?? 3;
  const backoffMs = options?.backoffMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Create child span for this retry attempt
      const retryContext = engine.createChildSpan(parentContext, {
        spanName: `retry:${attempt}`,
        retryAttempt: attempt,
      });

      const result = await runWithTraceContextAsync(retryContext, () =>
        operation(attempt)
      );

      await engine.recordSpanEvent(retryContext, 'API_ACCEPTED', {
        status: 'success',
        previousState: attempt === 0 ? 'INTENT_RECEIVED' : 'QUERY_INVALIDATED',
      });

      return result;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;

      // Record retry attempt
      const retryContext = engine.createChildSpan(parentContext, {
        spanName: `retry:${attempt}:failed`,
        retryAttempt: attempt,
      });

      await engine.recordSpanEvent(retryContext, 'API_ACCEPTED', {
        status: isLastAttempt ? 'error' : 'timeout',
        errorCode: isLastAttempt ? 'MAX_RETRIES_EXCEEDED' : 'RETRY_ATTEMPT',
        errorMessage: (error as Error)?.message,
      });

      if (isLastAttempt) {
        throw error;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, backoffMs * Math.pow(2, attempt)));
    }
  }

  throw new Error('Unreachable');
}

/**
 * TRANSACTIONAL BOUNDARY WRAPPER
 * ==============================
 * Maintains trace context through database transactions
 */

export async function executeInTransactionWithTrace<T>(
  transaction: (context: TraceContext) => Promise<T>,
  engine: GovernanceCausalityEngine
): Promise<T> {
  const parentContext = getTraceContextOrNull();
  if (!parentContext) {
    throw new Error('executeInTransactionWithTrace called without parent trace context');
  }

  const txnContext = engine.createChildSpan(parentContext, {
    spanName: 'db:transaction',
  });

  try {
    const result = await runWithTraceContextAsync(txnContext, () =>
      transaction(txnContext)
    );

    await engine.recordSpanEvent(txnContext, 'STATE_PERSISTED', {
      status: 'success',
    });

    return result;
  } catch (error) {
    await engine.recordSpanEvent(txnContext, 'STATE_PERSISTED', {
      status: 'error',
      errorCode: (error as any)?.code ?? 'TRANSACTION_FAILED',
      errorMessage: (error as Error)?.message,
    });
    throw error;
  }
}
