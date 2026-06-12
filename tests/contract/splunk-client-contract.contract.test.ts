/**
 * Contract: SplunkClient public surface
 *
 * splunk-queries-service.ts depends on restGet() and runSearch() — these were
 * previously called via `(splunk as any)` casts against methods that did not
 * exist, so saved-search inventory and parsing-error queries silently fell
 * back to zeros (utilization = 0, quality = 100 for everything).
 *
 * This test pins the public surface so interface drift fails CI instead of
 * silently zeroing scores.
 */

import { SplunkClient } from '../../apps/api/services/splunk-client';

describe('Contract: SplunkClient public surface', () => {
  const client = new SplunkClient({
    mcpUrl: 'https://splunk.invalid:8089',
    token: 'Splunk test-token',
  });

  const REQUIRED_METHODS = [
    'healthCheckFast',
    'getIndexMetrics',
    'getSourcetypeMetrics',
    'getBatchSourcetypeMetrics',
    'getSavedSearches',
    'restGet',
    'runSearch',
  ] as const;

  test.each(REQUIRED_METHODS)('%s is a public method', (method) => {
    expect(typeof (client as any)[method]).toBe('function');
  });

  test('runSearch injects time bounds only when SPL has none', async () => {
    // Intercept the private transport so no network call happens.
    const seen: string[] = [];
    (client as any).runSearchJob = async (spl: string) => {
      seen.push(spl);
      return [];
    };

    await client.runSearch('search index=main', { earliestTime: '-7d', latestTime: 'now' });
    expect(seen[0]).toContain('earliest=-7d');
    expect(seen[0]).toContain('latest=now');

    await client.runSearch('search index=main earliest=-24h latest=now', { earliestTime: '-7d' });
    // Pre-existing bounds must not be duplicated
    expect(seen[1].match(/earliest=/g)).toHaveLength(1);
  });
});
