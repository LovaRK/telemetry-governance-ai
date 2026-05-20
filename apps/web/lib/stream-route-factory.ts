/**
 * Stream Route Factory — Local version for web app SSE routes
 * Provides trace context for streaming endpoints (SSE, WebSocket, etc.)
 */

import { NextRequest } from 'next/server';
import { withTraceContext, initTraceFromRequest } from '@core/guards/trace-context';

/**
 * Create a properly-traced streaming route handler.
 * Used for SSE endpoints that return streaming responses.
 */
export function createStreamRoute(
  handler: (request: NextRequest, params?: any) => Promise<Response>
) {
  return async (request: NextRequest, params?: any) => {
    // Initialize trace context from request
    const traceId = initTraceFromRequest(request);

    // Run handler within trace context
    return await withTraceContext(traceId, async () => {
      const response = await handler(request, params);

      // Inject stream metadata into response headers for observability
      // (trace context already in AsyncLocalStorage from withTraceContext)
      response.headers.set('x-data-source', 'system');
      response.headers.set('x-data-mode', 'live');
      response.headers.set('x-trace-id', traceId);

      return response;
    });
  };
}
