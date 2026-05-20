/**
 * Trace Context Propagation (L3 — Unified)
 *
 * SINGLE SOURCE OF TRUTH
 * Every operation is bound to a traceId for end-to-end causality tracking.
 *
 * CRITICAL RULES:
 * 1. getTraceId() MUST throw if missing (no fallback uuid)
 * 2. All AsyncLocalStorage access through this module only
 * 3. Trace injected only at: request boundary + worker start
 */

import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuid } from 'uuid';

type TraceContext = { traceId: string };

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Initialize trace context for an async operation.
 * ONLY call at:
 * - Request boundary (middleware)
 * - Worker start (cron, sweeper, reconciliation)
 */
export function withTraceContext(traceId: string, fn: () => Promise<any>) {
  return storage.run({ traceId }, fn);
}

/**
 * Get current trace ID.
 * THROWS if called outside trace context (no fallback).
 * This is the invariant: every operation must be traced.
 */
export function getTraceId(): string {
  const ctx = storage.getStore();
  if (!ctx?.traceId) {
    throw new Error('❌ SYSTEM_INVARIANT_VIOLATION: Missing trace context');
  }
  return ctx.traceId;
}

/**
 * Extract or generate traceId from request.
 * Called at request entry point (middleware).
 */
export function initTraceFromRequest(req: any): string {
  // Extract from W3C traceparent or x-trace-id header
  const header = req.headers?.get?.('x-trace-id') ||
                 req.headers?.['x-trace-id'];

  if (header && typeof header === 'string') {
    return header;
  }

  // Generate new trace for this request
  return uuid();
}
