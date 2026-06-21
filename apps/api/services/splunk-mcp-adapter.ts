/**
 * Splunk MCP Adapter (experimental, feature-flagged)
 *
 * Implements SplunkDataSource over an MCP server (tools/mcp/client.ts) so the
 * aggregation pipeline can talk to Splunk through MCP tools instead of REST.
 * Activated only when a tenant has `splunk_mcp_url` configured.
 *
 * Every method is wrapped in a REST fallback: if the MCP call fails, errors,
 * or the operation has no MCP tool (McpUnsupportedError), the adapter logs a
 * warning and delegates to a real SplunkClient built from the same tenant
 * config. This keeps MCP strictly additive — a misbehaving or partial MCP
 * server never breaks a refresh.
 *
 * The real MCP server is out of scope for v1.0-handoff; only the flag + adapter
 * + fallback ship. See KNOWN_ISSUES.md.
 */

import { MCPClient } from '../../../tools/mcp/client';
import type { SplunkDataSource, SplunkClient, SplunkQueryResult } from './splunk-client';

export class McpUnsupportedError extends Error {
  constructor(op: string) {
    super(`MCP adapter has no tool for "${op}"`);
    this.name = 'McpUnsupportedError';
  }
}

type SavedSearchRow = Awaited<ReturnType<SplunkDataSource['getSavedSearches']>>;

export class SplunkMcpAdapter implements SplunkDataSource {
  private mcp: MCPClient;
  private rest: SplunkClient;
  private mcpUrl: string;

  /**
   * @param mcpUrl  MCP server base URL (tenant.splunk_mcp_url)
   * @param token   bearer token for the MCP server
   * @param rest    REST SplunkClient built from the same tenant config — the fallback
   */
  constructor(mcpUrl: string, token: string, rest: SplunkClient) {
    this.mcp = new MCPClient({ url: mcpUrl, token });
    this.rest = rest;
    this.mcpUrl = mcpUrl;
  }

  private async withFallback<T>(op: string, viaMcp: () => Promise<T>, viaRest: () => Promise<T>): Promise<T> {
    try {
      return await viaMcp();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.warn(`[MCP] ${op} via MCP (${this.mcpUrl}) failed — falling back to REST: ${why}`);
      return viaRest();
    }
  }

  async healthCheckFast(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    try {
      const state = await this.mcp.checkConnection();
      if (state.status === 'CONNECTED' || state.status === 'DEGRADED') {
        return { success: true, latencyMs: state.latency_ms };
      }
      console.warn(`[MCP] health ${state.status} — falling back to REST: ${state.error || ''}`);
    } catch (e) {
      console.warn(`[MCP] health check threw — falling back to REST: ${e instanceof Error ? e.message : e}`);
    }
    return this.rest.healthCheckFast();
  }

  async getIndexMetrics(): Promise<SplunkQueryResult[]> {
    return this.withFallback(
      'getIndexMetrics',
      async () => {
        const result = await this.mcp.callTool('get_index_metrics', {});
        if (!result.success) throw new Error(result.error || 'tool returned failure');
        const rows = (result.data as any)?.indexes;
        if (!Array.isArray(rows)) throw new McpUnsupportedError('get_index_metrics');
        return rows as SplunkQueryResult[];
      },
      () => this.rest.getIndexMetrics()
    );
  }

  async getSourcetypeMetrics(index: string): Promise<SplunkQueryResult[]> {
    return this.withFallback(
      'getSourcetypeMetrics',
      async () => {
        const result = await this.mcp.callTool('get_sourcetype_metrics', { index });
        if (!result.success) throw new Error(result.error || 'tool returned failure');
        const rows = (result.data as any)?.sourcetypes;
        if (!Array.isArray(rows)) throw new McpUnsupportedError('get_sourcetype_metrics');
        return rows as SplunkQueryResult[];
      },
      () => this.rest.getSourcetypeMetrics(index)
    );
  }

  async getBatchSourcetypeMetrics(indexes: string[]): Promise<SplunkQueryResult[]> {
    return this.withFallback(
      'getBatchSourcetypeMetrics',
      async () => {
        const result = await this.mcp.callTool('get_batch_sourcetype_metrics', { indexes });
        if (!result.success) throw new Error(result.error || 'tool returned failure');
        const rows = (result.data as any)?.sourcetypes;
        if (!Array.isArray(rows)) throw new McpUnsupportedError('get_batch_sourcetype_metrics');
        return rows as SplunkQueryResult[];
      },
      () => this.rest.getBatchSourcetypeMetrics(indexes)
    );
  }

  async getSavedSearches(): Promise<SavedSearchRow> {
    return this.withFallback(
      'getSavedSearches',
      async () => {
        const result = await this.mcp.callTool('get_saved_searches', {});
        if (!result.success) throw new Error(result.error || 'tool returned failure');
        const rows = (result.data as any)?.savedSearches;
        if (!Array.isArray(rows)) throw new McpUnsupportedError('get_saved_searches');
        return rows as SavedSearchRow;
      },
      () => this.rest.getSavedSearches()
    );
  }

  async runSearch(spl: string, opts?: { earliestTime?: string; latestTime?: string }): Promise<any[]> {
    return this.withFallback(
      'runSearch',
      async () => {
        const result = await this.mcp.callTool('run_search', { spl, ...opts });
        if (!result.success) throw new Error(result.error || 'tool returned failure');
        const rows = (result.data as any)?.results;
        if (!Array.isArray(rows)) throw new McpUnsupportedError('run_search');
        return rows;
      },
      () => this.rest.runSearch(spl, opts)
    );
  }

  // restGet is a raw management-API escape hatch with no MCP equivalent —
  // always served by REST (the fallback path).
  async restGet(pathWithQuery: string): Promise<any> {
    return this.rest.restGet(pathWithQuery);
  }
}
