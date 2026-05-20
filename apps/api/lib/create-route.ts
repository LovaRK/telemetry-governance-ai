/**
 * Route Factory — Global Enforcement
 *
 * CRITICAL: All API routes MUST use this factory.
 * No raw Response.json() exports allowed.
 * No bypass paths exist.
 *
 * Usage:
 * ```typescript
 * export const GET = createRoute(async (req) => ({
 *   data: { ... },
 *   meta: { source: 'postgres' }
 * }));
 * ```
 */

import { withTrace } from './with-trace';
import { withPureResponse } from './with-pure-response';

/**
 * Factory that ENFORCES trace + pure response on every route.
 * This is the ONLY way to export a route.
 */
export function createRoute(
  handler: (req: any, ...rest: any[]) => Promise<{ data: any; meta: any }>
) {
  return withTrace(withPureResponse(handler));
}

/**
 * Prevent accidental raw exports.
 * If you see this in production, a route bypassed the factory.
 */
export function mustUseCreateRoute(): never {
  throw new Error(
    '❌ ARCHITECTURE_VIOLATION: Route must use createRoute() factory. ' +
    'Direct export of async functions bypasses purity enforcement. ' +
    'See apps/api/lib/create-route.ts'
  );
}
