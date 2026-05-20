/**
 * API Response Purity Middleware
 *
 * Phase 5: Enforces that all API responses carry data purity metadata
 * Every response must include meta: { source, mode, traceId }
 *
 * Integration: Use as response wrapper in route handlers
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return withNextTraceContext(request, async () => {
 *     const data = await fetchData();
 *     return createPureResponse(data, 'postgres');
 *   });
 * }
 * ```
 */

import { NextResponse } from 'next/server';
import { getTraceId } from '@core/guards/trace-context';
import { enforceMeta } from './data-purity.middleware';

/**
 * Create a pure API response with all required metadata
 * Fails loudly if traceId is missing from context
 */
export function createPureResponse<T>(
  data: T,
  source: 'splunk' | 'postgres' | 'system',
  status: number = 200
): NextResponse {
  const traceId = getTraceId();

  if (!traceId) {
    // Fail loudly - no synthetic traceId
    console.error('❌ SYSTEM_INVARIANT_VIOLATION: Missing traceId in response context');
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Response missing required trace context',
      },
      { status: 500 }
    );
  }

  // Construct response with purity metadata
  const response = {
    data,
    meta: {
      source,
      mode: 'live',
      traceId,
    },
  };

  // Validate before sending
  try {
    enforceMeta(response);
  } catch (error) {
    console.error('❌ SYSTEM_INVARIANT_VIOLATION: Response failed purity enforcement', {
      error: error instanceof Error ? error.message : String(error),
      source,
      traceId,
    });

    // Fail loudly - send error response
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Response validation failed',
      },
      { status: 500 }
    );
  }

  // Return valid response
  return NextResponse.json(response, { status });
}

/**
 * Create a pure error response
 * Even error responses must carry trace context
 */
export function createPureErrorResponse(
  message: string,
  status: number = 400,
  source: 'splunk' | 'postgres' | 'system' = 'system'
): NextResponse {
  const traceId = getTraceId();

  if (!traceId) {
    console.error('❌ SYSTEM_INVARIANT_VIOLATION: Missing traceId in error response');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      error: message,
      meta: {
        source,
        mode: 'live',
        traceId,
      },
    },
    { status }
  );
}

/**
 * Wrapper for handler that ensures all responses carry purity metadata
 *
 * Usage:
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return withPureResponse(request, 'postgres', async () => {
 *     // Your handler logic here
 *     return data;
 *   });
 * }
 * ```
 */
export async function withPureResponse<T>(
  source: 'splunk' | 'postgres' | 'system',
  handler: () => Promise<T>,
  status: number = 200
): Promise<NextResponse> {
  try {
    const data = await handler();
    return createPureResponse(data, source, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createPureErrorResponse(message, 500, source);
  }
}
