import { withTrace } from './with-trace';

/**
 * Factory for streaming endpoints (SSE, WebSocket, Server-Sent Events)
 *
 * Enforces trace context injection via AsyncLocalStorage while allowing
 * streaming responses that don't conform to {data, meta} JSON structure.
 *
 * SSE event payloads MUST include:
 * - source: 'system' | 'postgres' | 'splunk'
 * - mode: 'live' (only; use replayed: boolean for delivery semantics)
 * - replayed: boolean (true if historical/bootstrapped event)
 * - traceId: from request context
 *
 * Usage:
 *   export const GET = createStreamRoute(async (request) => {
 *     return new Response(stream, {
 *       headers: {
 *         'Content-Type': 'text/event-stream',
 *         'Cache-Control': 'no-cache',
 *         'Connection': 'keep-alive',
 *       },
 *     });
 *   });
 */
export function createStreamRoute(
  handler: (request: Request, params?: any) => Promise<Response>
) {
  return withTrace(async (request: Request, params?: any) => {
    const response = await handler(request, params);

    // Inject stream metadata into response headers for observability
    // (trace context already in AsyncLocalStorage from withTrace)
    response.headers.set('x-data-source', 'system');
    response.headers.set('x-data-mode', 'live');

    return response;
  });
}
