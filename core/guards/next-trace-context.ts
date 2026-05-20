/**
 * Next.js Trace Context Wrapper
 *
 * Adapts the AsyncLocalStorage trace context for Next.js API route handlers.
 * Provides a wrapper that extracts traceId from request headers and
 * initializes AsyncLocalStorage for the request lifecycle.
 */

import { NextRequest } from 'next/server';
import { withTraceContext, getTraceId } from './trace-context';

/**
 * Wrap a Next.js API handler with trace context
 * Extracts x-trace-id header and initializes AsyncLocalStorage
 *
 * Usage in route.ts:
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return withNextTraceContext(request, async () => {
 *     const traceId = getTraceId();
 *     // ... handler logic
 *   });
 * }
 * ```
 */
export async function withNextTraceContext<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  // Extract traceId from request headers (set by middleware)
  // Falls back to empty string if not found - validation guards will catch this
  const traceId = request.headers.get('x-trace-id') || '';

  // Initialize AsyncLocalStorage with trace context
  return withTraceContext(traceId, handler);
}

/**
 * Export getTraceId for use in handlers
 * Must be called within withNextTraceContext or equivalent wrapper
 */
export { getTraceId };
