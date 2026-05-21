import { MCPConfig, MCPConnectionState, MCPToolResult } from './types';

export class MCPClient {
  private url: string;
  private token: string;

  constructor(config: MCPConfig) {
    this.url = config.url;
    this.token = config.token;
  }

  async checkConnection(): Promise<MCPConnectionState> {
    try {
      const start = Date.now();
      const response = await fetch(`${this.url}/health`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      const latency = Date.now() - start;

      if (!response.ok) {
        if (response.status === 401) {
          return { status: 'AUTH_FAILED', indexes: [], sources: 0, latency_ms: latency, capabilities: { search: false, stats: false }, error: 'Invalid token' };
        }
        return { status: 'NO_INDEX_ACCESS', indexes: [], sources: 0, latency_ms: latency, capabilities: { search: false, stats: false }, error: `HTTP ${response.status}` };
      }

      const data = await response.json() as { indexes?: string[]; sources?: number };

      return {
        status: latency > 500 ? 'DEGRADED' : 'CONNECTED',
        indexes: data.indexes || [],
        sources: data.sources || 0,
        latency_ms: latency,
        capabilities: { search: true, stats: true }
      };
    } catch (error) {
      return {
        status: 'NO_INDEX_ACCESS',
        indexes: [],
        sources: 0,
        latency_ms: 0,
        capabilities: { search: false, stats: false },
        error: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      const response = await fetch(`${this.url}/tools/${toolName}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(args)
      });

      if (!response.ok) {
        return { success: false, error: `Tool call failed: ${response.status}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Tool call failed' };
    }
  }
}