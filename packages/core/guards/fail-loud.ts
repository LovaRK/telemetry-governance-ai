/**
 * Fail-Loud Guard
 *
 * Converts any error into a SYSTEM_INVARIANT_VIOLATION signal.
 * Never silently falls back or masks errors.
 */

import { logger } from '@infra/observability';

export function failLoudly(error: Error): never {
  logger.error('SYSTEM_INVARIANT_VIOLATION', {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });

  throw new Error(`SYSTEM_INVARIANT_VIOLATION: ${error.message}`);
}
