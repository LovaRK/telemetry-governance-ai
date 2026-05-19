'use server';

import { getCorrelationContext, injectToHeaders, extractFromHeaders, runWithCorrelation } from './correlation-context';

/**
 * Correlation Propagation — 5 Boundary Adapters
 *
 * Ensures correlation IDs flow across async boundaries:
 * 1. SSE streaming (request/response)
 * 2. Queue processing (task enqueue/dequeue)
 * 3. Fetch/API calls (outbound HTTP)
 * 4. TanStack Query (cache + network)
 * 5. Async task retry (exponential backoff)
 */

// ============================================================================
// 1. SSE STREAMING ADAPTER
// ============================================================================

export interface SSEEvent {
  id?: string;
  event: string;
  data: string;
  retry?: number;
}

export function createSSEMessage(
  event: string,
  data: any,
  options?: { retry?: number }
): SSEEvent {
  const context = getCorrelationContext();

  return {
    id: context?.correlationId,
    event,
    data: JSON.stringify({
      ...data,
      __correlationId: context?.correlationId,
      __parentDecisionId: context?.parentDecisionId,
    }),
    retry: options?.retry,
  };
}

export function parseSSEEvent(message: SSEEvent): {
  event: string;
  data: any;
  correlationId?: string;
} {
  const data = JSON.parse(message.data);
  return {
    event: message.event,
    data,
    correlationId: data.__correlationId || message.id,
  };
}

// ============================================================================
// 2. QUEUE BOUNDARY ADAPTER
// ============================================================================

export interface QueueTask {
  id: string;
  type: string;
  payload: any;
  metadata: {
    correlationId: string;
    parentDecisionId?: string;
    enqueueTime: number;
    retryCount: number;
  };
}

export function enqueueWithCorrelation(
  taskType: string,
  payload: any,
  options?: { parentDecisionId?: string }
): Partial<QueueTask> {
  const context = getCorrelationContext();

  return {
    type: taskType,
    payload,
    metadata: {
      correlationId: context?.correlationId || `task_${Date.now()}`,
      parentDecisionId: options?.parentDecisionId || context?.parentDecisionId,
      enqueueTime: Date.now(),
      retryCount: 0,
    },
  };
}

export async function processQueueTaskWithContext<T>(
  task: QueueTask,
  processor: () => T | Promise<T>
): Promise<T> {
  return runWithCorrelation(processor, {
    correlationId: task.metadata.correlationId,
    parentDecisionId: task.metadata.parentDecisionId,
  });
}

// ============================================================================
// 3. FETCH/API ADAPTER
// ============================================================================

export interface FetchOptions extends RequestInit {
  correlationId?: string;
}

export async function fetchWithCorrelation(
  url: string,
  options?: FetchOptions
): Promise<Response> {
  const context = getCorrelationContext();

  const headers = injectToHeaders({
    ...((options?.headers as Record<string, string>) || {}),
  });

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Extract correlation ID from response headers (for response tracking)
  const responseCorrelationId = response.headers.get('x-correlation-id');
  if (responseCorrelationId) {
    // Log or track response correlation for tracing
    console.debug(`[Correlation] Response: ${responseCorrelationId}`);
  }

  return response;
}

// ============================================================================
// 4. TANSTACK QUERY ADAPTER
// ============================================================================

export interface QueryContextOptions {
  correlationId?: string;
  parentDecisionId?: string;
}

export async function queryWithContext<T>(
  queryKey: string[],
  queryFn: () => Promise<T>,
  options?: QueryContextOptions
): Promise<T> {
  const context = getCorrelationContext();

  return runWithCorrelation(queryFn, {
    correlationId: options?.correlationId,
    parentDecisionId: options?.parentDecisionId || context?.parentDecisionId,
  });
}

/**
 * TanStack Query middleware to inject correlation context
 * Usage:
 * ```typescript
 * const queryClient = new QueryClient({
 *   queryCache: new QueryCache({
 *     onSuccess: (data, query) => {
 *       correlationQueryMiddleware(query);
 *     }
 *   })
 * });
 * ```
 */
export function correlationQueryMiddleware(query: any): void {
  const context = getCorrelationContext();
  if (context) {
    // Attach correlation metadata to query for tracking
    query.meta = query.meta || {};
    query.meta.correlationId = context.correlationId;
    query.meta.parentDecisionId = context.parentDecisionId;
  }
}

// ============================================================================
// 5. ASYNC TASK RETRY ADAPTER
// ============================================================================

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Retry a function with exponential backoff, preserving correlation context
 */
export async function retryWithCorrelation<T>(
  fn: () => Promise<T>,
  policy: Partial<RetryPolicy> = {}
): Promise<T> {
  const fullPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  const context = getCorrelationContext();

  let lastError: Error | null = null;
  let delay = fullPolicy.baseDelayMs;

  for (let attempt = 1; attempt <= fullPolicy.maxAttempts; attempt++) {
    try {
      return await runWithCorrelation(fn, {
        correlationId: context?.correlationId,
        parentDecisionId: context?.parentDecisionId,
      });
    } catch (error) {
      lastError = error as Error;
      console.warn(
        `[Correlation] Retry ${attempt}/${fullPolicy.maxAttempts} failed for correlation ${context?.correlationId}:`,
        error
      );

      if (attempt < fullPolicy.maxAttempts) {
        // Exponential backoff with jitter
        const jitter = Math.random() * 0.1 * delay;
        const delayWithJitter = delay + jitter;
        await new Promise((resolve) => setTimeout(resolve, Math.min(delayWithJitter, fullPolicy.maxDelayMs)));
        delay *= fullPolicy.backoffMultiplier;
      }
    }
  }

  throw new Error(
    `Failed after ${fullPolicy.maxAttempts} attempts for correlation ${context?.correlationId}: ${lastError?.message}`
  );
}

// ============================================================================
// LOGGING & TRACING
// ============================================================================

export interface TraceEntry {
  timestamp: number;
  correlationId: string;
  boundary: 'sse' | 'queue' | 'fetch' | 'query' | 'retry';
  action: 'enter' | 'exit' | 'error';
  metadata?: Record<string, any>;
}

const traceLog: TraceEntry[] = [];

export function logTrace(
  boundary: TraceEntry['boundary'],
  action: TraceEntry['action'],
  metadata?: Record<string, any>
): void {
  const context = getCorrelationContext();
  if (context) {
    traceLog.push({
      timestamp: Date.now(),
      correlationId: context.correlationId,
      boundary,
      action,
      metadata,
    });
  }
}

export function getTraceLog(correlationId: string): TraceEntry[] {
  return traceLog.filter((entry) => entry.correlationId === correlationId);
}

export function clearTraceLog(): void {
  traceLog.length = 0;
}
