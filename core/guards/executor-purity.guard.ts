/**
 * Executor Purity Guard
 *
 * Wraps executor outputs to enforce data purity.
 * Every execution result must carry source attribution, mode, and traceId.
 *
 * Phase 4 Integration: Inject at executor output boundaries
 */

import { getTraceId } from './trace-context';
import { assertDataPurity, DataPurityMeta, DataSource } from './data-purity.guard';
import { failLoudly } from './fail-loud';

/**
 * Execution result with purity metadata
 */
export interface PureExecutionResult {
  actionId: string;
  status: 'success' | 'failed';
  result?: any;
  error?: string;
  timestamp: Date;
  source: DataSource;
  mode: 'live';
  traceId: string;
}

/**
 * Wrap executor results with data purity metadata
 *
 * Usage:
 * ```typescript
 * const result = await executeAction(action);
 * const pureResult = wrapExecutionResult(result, 'system');
 * ```
 */
export function wrapExecutionResult(
  result: any,
  source: DataSource
): PureExecutionResult {
  const traceId = getTraceId();

  // Construct purity metadata
  const meta: DataPurityMeta = {
    source,
    mode: 'live',
    traceId,
  };

  // Validate metadata - fail loudly on any violation
  try {
    assertDataPurity(meta);
  } catch (error) {
    if (error instanceof Error) {
      failLoudly(error);
    } else {
      failLoudly(new Error(`Data purity validation failed: ${String(error)}`));
    }
  }

  // Return result with purity metadata attached
  return {
    actionId: result.actionId,
    status: result.status,
    result: result.result,
    error: result.error,
    timestamp: result.timestamp || new Date(),
    source,
    mode: 'live',
    traceId,
  };
}

/**
 * Validate a result carries all required purity metadata
 */
export function validateExecutionPurity(result: any): boolean {
  if (!result.source) return false;
  if (!result.mode) return false;
  if (!result.traceId) return false;

  // Re-validate through assertDataPurity
  try {
    assertDataPurity({
      source: result.source,
      mode: result.mode,
      traceId: result.traceId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard function for executor output
 * Call this immediately after executor returns
 */
export function guardExecutorOutput(result: any, source: DataSource): PureExecutionResult {
  if (!result) {
    failLoudly(new Error('❌ Executor returned null/undefined result'));
  }

  return wrapExecutionResult(result, source);
}
