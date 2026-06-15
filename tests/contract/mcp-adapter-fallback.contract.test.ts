/**
 * Contract: MCP adapter falls back to REST
 *
 * The MCP feature flag is strictly additive — when a tenant has
 * splunk_mcp_url set but the MCP server is unreachable / returns failure /
 * lacks a tool, the adapter must transparently serve the request via the
 * REST SplunkClient. A broken or partial MCP server must never break a
 * refresh.
 */

import { SplunkMcpAdapter } from '../../apps/api/services/splunk-mcp-adapter';
import { SplunkClient } from '../../apps/api/services/splunk-client';

function fakeRest(): SplunkClient {
  // A SplunkClient whose transport is stubbed to return deterministic data
  // without any network call.
  const rest = new SplunkClient({ mcpUrl: 'https://rest.invalid:8089', token: 'Splunk x' });
  (rest as any).healthCheckFast = async () => ({ success: true, latencyMs: 7 });
  (rest as any).getIndexMetrics = async () => [
    { index: 'main', totalEvents: 10, dailyAvgGb: 1, retentionDays: 90, firstEvent: '', lastEvent: '' },
  ];
  (rest as any).getBatchSourcetypeMetrics = async () => [
    { index: 'main', sourcetype: 'syslog', totalEvents: 5, dailyAvgGb: 0, retentionDays: 90, firstEvent: '', lastEvent: '' },
  ];
  (rest as any).getSavedSearches = async () => [
    { name: 'ss', app: 'search', isScheduled: true, isAlert: false, schedule: '*', lastRun: null, disabled: false },
  ];
  (rest as any).runSearch = async () => [{ idx: 'main', st: 'syslog', weighted_issues: '3' }];
  (rest as any).restGet = async () => ({ entry: [] });
  return rest;
}

describe('Contract: SplunkMcpAdapter REST fallback', () => {
  const rest = fakeRest();
  // MCP server is unreachable (.invalid host) — every MCP call will throw.
  const adapter = new SplunkMcpAdapter('https://mcp.invalid:9000', 'tok', rest);

  test('getIndexMetrics falls back to REST data when MCP is down', async () => {
    const rows = await adapter.getIndexMetrics();
    expect(rows).toHaveLength(1);
    expect(rows[0].index).toBe('main');
  });

  test('getBatchSourcetypeMetrics falls back to REST', async () => {
    const rows = await adapter.getBatchSourcetypeMetrics(['main']);
    expect(rows[0].sourcetype).toBe('syslog');
  });

  test('getSavedSearches falls back to REST', async () => {
    const rows = await adapter.getSavedSearches();
    expect(rows[0].name).toBe('ss');
  });

  test('runSearch falls back to REST', async () => {
    const rows = await adapter.runSearch('search index=main');
    expect(rows[0]).toMatchObject({ idx: 'main', st: 'syslog' });
  });

  test('healthCheckFast falls back to REST success', async () => {
    const h = await adapter.healthCheckFast();
    expect(h.success).toBe(true);
  });

  test('restGet is always served by REST (no MCP tool)', async () => {
    const r = await adapter.restGet('/services/data/indexes');
    expect(r).toEqual({ entry: [] });
  });

  test('adapter satisfies the SplunkDataSource surface', () => {
    for (const m of ['healthCheckFast', 'getIndexMetrics', 'getSourcetypeMetrics', 'getBatchSourcetypeMetrics', 'getSavedSearches', 'restGet', 'runSearch']) {
      expect(typeof (adapter as any)[m]).toBe('function');
    }
  });
});
