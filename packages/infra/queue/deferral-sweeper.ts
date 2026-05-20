/**
 * Deferral Sweeper
 *
 * Worker that processes deferred decisions and reactivates them when their deferral period expires.
 * Preserves truth: this module is trace-bound and fails loudly until implementation is complete.
 * Used by chaos tests to validate deferred decision lifecycle.
 */

import { withWorkerTrace } from '@core/workers/worker-trace-wrapper';
import type { PrismaClient } from '@prisma/client';

export interface DeferralSweeperOptions {
  maxAge?: number;
  batch?: number;
}

export interface DeferralSweeperResult {
  processedCount: number;
  reactivatedCount: number;
  errorsCount: number;
}

/**
 * Process deferred decisions and reactivate those whose deferral period has expired.
 * Trace-bound via withWorkerTrace, which ensures all operations carry a traceId.
 * Fails loudly with DEFERRAL_SWEEPER_NOT_IMPLEMENTED until full implementation.
 */
export async function runDeferralSweeper(
  db?: PrismaClient,
  options: DeferralSweeperOptions = {}
): Promise<DeferralSweeperResult> {
  return withWorkerTrace('deferral-sweeper', async () => {
    throw new Error(
      '[DEFERRAL_SWEEPER] Not yet implemented. Chaos tests should skip this module or mock it. ' +
      'When ready: 1. Query deferred decisions where deferredUntil < NOW(), 2. Reactivate them, 3. Emit lifecycle events.'
    );
  });
}

/**
 * Legacy export for backward compatibility
 */
export async function deferralSweeper(
  db: PrismaClient,
  options: DeferralSweeperOptions = {}
): Promise<DeferralSweeperResult> {
  return runDeferralSweeper(db, options);
}
