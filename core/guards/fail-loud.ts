/**
 * Fail-Loud Guard (Structured)
 *
 * CRITICAL: Never silently falls back or masks errors.
 * Always logs with traceId for queryability and observability.
 *
 * Logs as JSON for aggregation and debugging.
 */

import { getTraceId } from './trace-context';

export function failLoudly(error: Error): never {
  const traceId = getTraceId();

  // Structured logging with trace
  console.error(JSON.stringify({
    type: 'SYSTEM_INVARIANT_VIOLATION',
    traceId,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  }));

  // Throw to fail fast
  throw error;
}
