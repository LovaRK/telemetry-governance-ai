/**
 * Data Purity Enforcement Guard
 *
 * Enforces system invariant: All runtime data originates from Splunk, PostgreSQL, or system.
 * No synthetic data, fallbacks, mocks, or defaults are allowed.
 */

export type DataSource = 'splunk' | 'postgres' | 'system';

export interface DataPurityMeta {
  source: DataSource;
  mode: 'live';
  traceId: string;
}

/**
 * Assert that data carries proper purity metadata.
 * Throws immediately if any field is missing or invalid.
 */
export function assertDataPurity(meta: Partial<DataPurityMeta>): void {
  if (!meta) {
    throw new Error('❌ Missing meta (data purity violation)');
  }

  if (!meta.source) {
    throw new Error('❌ Missing source attribution');
  }

  if (!['splunk', 'postgres', 'system'].includes(meta.source)) {
    throw new Error(`❌ Invalid source: ${meta.source}`);
  }

  if (meta.mode !== 'live') {
    throw new Error(`❌ Non-live mode detected: ${meta.mode}`);
  }

  if (!meta.traceId) {
    throw new Error('❌ Missing traceId for distributed tracing');
  }
}
