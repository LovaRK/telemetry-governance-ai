/**
 * Route Wrapper: Global API Response Purity Enforcement
 *
 * MANDATORY second wrapper after withTrace.
 * Guarantees ALL responses carry: source + mode + traceId
 *
 * Usage:
 * ```typescript
 * export const GET = withTrace(
 *   withPureResponse(async (req: Request) => {
 *     const data = await fetchData();
 *     return {
 *       data,
 *       meta: { source: 'postgres' },
 *     };
 *   })
 * );
 * ```
 */

import { NextResponse } from 'next/server';
import { getTraceId } from '@core/guards/trace-context';
import { assertDataPurity } from '@core/guards/data-purity.guard';
import { failLoudly } from '@core/guards/fail-loud';

export function withPureResponse(
  handler: (req: any, ...rest: any[]) => Promise<any>
) {
  return async (req: any, ...rest: any[]) => {
    try {
      const result = await handler(req, ...rest);

      // Validate response has meta
      if (!result?.meta) {
        failLoudly(new Error('❌ Missing meta in API response'));
      }

      // Inject traceId into meta
      const traceId = getTraceId(); // Throws if missing
      const meta = {
        ...result.meta,
        mode: 'live',
        traceId,
      };

      // Validate purity
      assertDataPurity(meta);

      // Return response
      return NextResponse.json(
        {
          ...result,
          meta,
        },
        { status: 200 }
      );
    } catch (error) {
      // Error response still carries trace
      const traceId = getTraceId();
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
