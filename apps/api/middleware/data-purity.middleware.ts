/**
 * Data Purity API Middleware
 *
 * Enforces that all API responses carry proper source attribution.
 */

import { assertDataPurity } from '@core/guards/data-purity.guard';

export interface ApiResponse<T = any> {
  data: T;
  meta: {
    source: 'splunk' | 'postgres' | 'system';
    mode: 'live';
    traceId: string;
  };
}

export function enforceMeta(response: any): void {
  if (!response?.meta) {
    throw new Error('❌ Missing meta in API response');
  }

  assertDataPurity(response.meta);
}
