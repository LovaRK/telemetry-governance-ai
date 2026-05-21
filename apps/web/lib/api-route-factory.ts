/**
 * Route Factory — Local version for web app API routes
 * Provides trace context and response purity enforcement
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTraceContext, initTraceFromRequest, getTraceId } from '@core/guards/trace-context';

interface APIResponse {
  data?: any;
  meta: {
    source: string;
    [key: string]: any;
  };
}

interface ErrorResponse {
  error: string;
  meta: {
    source: string;
    mode: string;
    traceId: string;
  };
}

/**
 * Create a properly-traced API route handler.
 * MUST be used for all API routes to ensure trace context + purity.
 */
export function createRoute(
  handler: (req: NextRequest, ...rest: any[]) => Promise<APIResponse | NextResponse>
) {
  return async (req: NextRequest, ...rest: any[]) => {
    try {
      // Initialize trace context from request
      const traceId = initTraceFromRequest(req);

      // Run handler within trace context
      return await withTraceContext(traceId, async () => {
        const result = await handler(req, ...rest);

        // If handler returned NextResponse directly, return it (supports custom status codes)
        if (result instanceof NextResponse) {
          return result;
        }

        // Validate response has meta
        if (!result?.meta) {
          throw new Error('Missing meta in API response');
        }

        // Inject traceId into meta
        const meta = {
          ...result.meta,
          mode: 'live',
          traceId,
        };

        // Return response with trace
        return NextResponse.json(
          {
            ...result,
            meta,
          },
          { status: 200 }
        );
      });
    } catch (error) {
      // Error response still carries trace
      let traceId: string;
      try {
        traceId = getTraceId();
      } catch {
        traceId = 'unknown';
      }

      const message = error instanceof Error ? error.message : 'Unknown error';

      return NextResponse.json(
        {
          error: message,
          meta: {
            source: 'system',
            mode: 'live',
            traceId,
          },
        },
        { status: 500 }
      );
    }
  };
}
