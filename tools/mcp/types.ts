export interface MCPConfig {
  url: string;
  token: string;
}

export interface MCPConnectionState {
  status: 'CONNECTED' | 'DEGRADED' | 'AUTH_FAILED' | 'NO_INDEX_ACCESS' | 'NO_DATA' | 'PARTIAL_DATA';
  indexes: string[];
  sources: number;
  latency_ms: number;
  capabilities: {
    search: boolean;
    stats: boolean;
  };
  error?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}