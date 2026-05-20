/**
 * Worker Trace Injection
 *
 * Apply this wrapper to ALL background workers:
 * - Reconciliation jobs
 * - Sweeper tasks
 * - Cron jobs
 * - Queue processors
 *
 * Ensures workers have a parent trace context.
 */

import { v4 as uuid } from 'uuid';
import { withTraceContext } from '@core/guards/trace-context';

/**
 * Wrap a worker function with trace context.
 *
 * Usage in reconciliation-worker.ts:
 * ```typescript
 * export async function runReconciliationWorker() {
 *   return withWorkerTrace('reconciliation', async () => {
 *     await reconcileExecutions();
 *   });
 * }
 * ```
 */
export async function withWorkerTrace(
  workerName: string,
  fn: () => Promise<void>
) {
  const traceId = uuid();

  try {
    return await withTraceContext(traceId, async () => {
      console.log(JSON.stringify({
        type: 'WORKER_STARTED',
        workerName,
        traceId,
        timestamp: new Date().toISOString(),
      }));

      await fn();

      console.log(JSON.stringify({
        type: 'WORKER_COMPLETED',
        workerName,
        traceId,
        timestamp: new Date().toISOString(),
      }));
    });
  } catch (error) {
    console.error(JSON.stringify({
      type: 'WORKER_FAILED',
      workerName,
      traceId,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    throw error;
  }
}
