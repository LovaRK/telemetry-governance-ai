/**
 * Adapter Purity Guard
 *
 * Wraps adapter outputs to enforce data purity metadata.
 * Every adapter result must carry source attribution and traceId.
 *
 * Phase 4 Integration: Inject at adapter output boundaries
 */

import { getTraceId } from './trace-context';
import { assertDataPurity, DataPurityMeta } from './data-purity.guard';
import { failLoudly } from './fail-loud';

export type AdapterSource = 'splunk' | 'postgres' | 'system';

/**
 * Decorator for adapter methods
 * Wraps output with data purity metadata
 *
 * Usage:
 * ```typescript
 * class SplunkHttpAdapter {
 *   @withAdapterPurity('splunk')
 *   async deleteIndex(input: DeleteIndexInput): Promise<DeleteIndexOutput> {
 *     // ... adapter logic
 *   }
 * }
 * ```
 */
export function withAdapterPurity(source: AdapterSource) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        // Execute original adapter method
        const result = await originalMethod.apply(this, args);

        // Wrap result with purity metadata
        const traceId = getTraceId();
        const meta: DataPurityMeta = {
          source,
          mode: 'live',
          traceId,
        };

        // Validate metadata before returning
        assertDataPurity(meta);

        // Attach metadata to result object
        return {
          ...result,
          _purityMeta: meta,
        };
      } catch (error) {
        // Fail loudly - no silent fallbacks
        if (error instanceof Error) {
          failLoudly(error);
        } else {
          failLoudly(new Error(`Adapter error: ${String(error)}`));
        }
      }
    };

    return descriptor;
  };
}

/**
 * Manual wrapper for adapter results (when decorators can't be used)
 *
 * Usage:
 * ```typescript
 * const result = await adapter.deleteIndex(input);
 * const pureResult = wrapAdapterResult(result, 'splunk');
 * ```
 */
export function wrapAdapterResult<T>(
  result: T,
  source: AdapterSource
): T & { _purityMeta: DataPurityMeta } {
  const traceId = getTraceId();
  const meta: DataPurityMeta = {
    source,
    mode: 'live',
    traceId,
  };

  // Validate metadata
  assertDataPurity(meta);

  return {
    ...result,
    _purityMeta: meta,
  };
}

/**
 * Utility to extract purity metadata from adapter result
 */
export function getPurityMeta(result: any): DataPurityMeta | null {
  if (result && result._purityMeta) {
    return result._purityMeta;
  }
  return null;
}
