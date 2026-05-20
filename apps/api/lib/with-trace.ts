/**
 * Route Wrapper: Trace Context Injection
 *
 * MANDATORY for all API routes.
 * Ensures traceId exists for the entire request lifecycle.
 *
 * Usage:
 * ```typescript
 * export const GET = withTrace(async (req: Request) => {
 *   const traceId = getTraceId(); // Always valid
 *   // ... handler logic
 * });
 * ```
 */

import { NextRequest } from 'next/server';
import {
  withTraceContext,
  initTraceFromRequest,
} from '@core/guards/trace-context';

/**
 * Wrap route handler with trace context.
 * Extracts/generates traceId and initializes AsyncLocalStorage.
 */
export function withTrace(handler: (req: NextRequest, ...rest: any[]) => Promise<any>) {
  return async (req: NextRequest, ...rest: any[]) => {
    const traceId = initTraceFromRequest(req);
    return withTraceContext(traceId, async () => {
      return handler(req, ...rest);
    });
  };
}
