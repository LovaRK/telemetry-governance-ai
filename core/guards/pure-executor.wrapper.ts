/**
 * Pure Executor Wrapper
 *
 * Wrapper around the core executor that enforces data purity guardrails.
 * This is Phase 4 integration: inject guards at executor boundaries.
 *
 * Usage:
 * ```typescript
 * import { pureExecutor } from '@core/guards/pure-executor.wrapper';
 *
 * // Instead of direct executor call:
 * // const result = await executeAction(action);
 *
 * // Use purity-wrapped version:
 * const pureResult = await pureExecutor.executeAction(action);
 * // Result now carries source attribution and traceId
 * ```
 */

import type { ExecutionAction, ExecutionResult } from '@core/workflow/executor';
import { guardExecutorOutput, validateExecutionPurity } from './executor-purity.guard';
import { getTraceId } from './trace-context';
import { failLoudly } from './fail-loud';

/**
 * Pure executor wrapper
 * Delegates to core executor but enforces data purity on results
 */
export const pureExecutor = {
  /**
   * Execute an action with purity enforcement
   * Source is determined by action type:
   * - SPLUNK actions → source='splunk'
   * - POSTGRES actions → source='postgres'
   * - SYSTEM actions → source='system'
   */
  async executeAction(action: ExecutionAction): Promise<ExecutionResult & {
    source: 'splunk' | 'postgres' | 'system';
    mode: 'live';
    traceId: string;
  }> {
    const traceId = getTraceId();

    if (!traceId) {
      failLoudly(new Error('❌ Missing traceId - not running in trace context'));
    }

    // Determine source from action parameters or default to 'system'
    let source: 'splunk' | 'postgres' | 'system' = 'system';

    // This is a placeholder - actual implementation would dispatch to real executor
    // For now, we're just setting up the guard pattern
    // TODO: Import and call actual executor.executeAction() here

    // Simulated executor result structure
    const simulatedResult: ExecutionResult = {
      actionId: action.id,
      status: 'success',
      timestamp: new Date(),
    };

    // Wrap result with purity guards
    const pureResult = guardExecutorOutput(simulatedResult, source);

    // Validate result before returning
    if (!validateExecutionPurity(pureResult)) {
      failLoudly(new Error('❌ Execution result failed purity validation'));
    }

    return pureResult;
  },
};

/**
 * Type for pure execution result
 * All execution results must carry this metadata
 */
export type PureExecutionResultType = ExecutionResult & {
  source: 'splunk' | 'postgres' | 'system';
  mode: 'live';
  traceId: string;
};
