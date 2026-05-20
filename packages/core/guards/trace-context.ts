/**
 * Trace Context Propagation
 *
 * Enforces distributed tracing across all execution paths.
 * Every operation is bound to a traceId for end-to-end causality tracking.
 *
 * CRITICAL: traceId generation is ONLY allowed at request boundary or worker start.
 * DO NOT generate new traceIds inside business logic.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuid } from 'uuid';

export type TraceContext = {
  traceId: string;
  timestamp: number;
};

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Wrap an async operation with trace context.
 * Used at request boundaries and worker starts.
 */
export function withTraceContext(traceId: string, fn: () => Promise<any>) {
  return storage.run({ traceId, timestamp: Date.now() }, fn);
}

/**
 * Get current trace ID.
 * MUST be called within withTraceContext or a wrapped execution path.
 * Fallback (uuid generation) ONLY allowed at request boundary.
 */
export function getTraceId(): string {
  const ctx = storage.getStore();
  return ctx?.traceId || '';
}
