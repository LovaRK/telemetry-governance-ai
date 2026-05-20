/**
 * Adapter Registry with Automatic Purity Enforcement
 *
 * CRITICAL: All adapter calls are wrapped at registry level.
 * No adapter can bypass data purity validation.
 *
 * Usage:
 * ```typescript
 * const adapter = getAdapter('splunk');
 * const result = await adapter.execute(params);
 * // result is guaranteed to have: source, mode, traceId
 * ```
 */

import { getTraceId } from '@core/guards/trace-context';
import { assertDataPurity, DataSource } from '@core/guards/data-purity.guard';
import { failLoudly } from '@core/guards/fail-loud';

export interface AdapterResult {
  [key: string]: any;
  source?: DataSource;
  mode?: 'live';
  traceId?: string;
}

export interface ExternalAdapter {
  execute(params: any): Promise<AdapterResult>;
}

/**
 * Registry of all external adapters.
 * Add new adapters here — they are automatically enforced.
 */
const registry: Record<string, ExternalAdapter> = {
  // Populate with actual adapters
  // splunk: new SplunkHttpAdapter(...),
  // datadog: new DatadogAdapter(...),
  // postgres: new PostgresAdapter(...),
};

/**
 * Get adapter with automatic purity enforcement.
 * Every call is wrapped with:
 * - Result enrichment (source, mode, traceId)
 * - Purity validation
 * - Fail-loud on violation
 */
export function getAdapter(name: string): ExternalAdapter {
  const adapter = registry[name];

  if (!adapter) {
    failLoudly(new Error(`❌ Unknown adapter: ${name}`));
  }

  // Wrap the adapter to enforce purity
  return {
    async execute(params: any) {
      let result: any;

      try {
        result = await adapter.execute(params);
      } catch (error) {
        // Don't enrich on error — let it propagate
        throw error;
      }

      if (!result) {
        failLoudly(new Error(`❌ Adapter ${name} returned null`));
      }

      // Enrich result with purity metadata
      const traceId = getTraceId(); // Throws if missing
      const enriched: AdapterResult = {
        ...result,
        source: name as DataSource,
        mode: 'live',
        traceId,
      };

      // Validate before returning
      try {
        assertDataPurity(enriched);
      } catch (error) {
        failLoudly(
          error instanceof Error
            ? error
            : new Error(`Adapter ${name} failed purity validation`)
        );
      }

      return enriched;
    },
  };
}

/**
 * Register an adapter at runtime.
 * Called during bootstrap.
 */
export function registerAdapter(name: string, adapter: ExternalAdapter) {
  registry[name] = adapter;
}
