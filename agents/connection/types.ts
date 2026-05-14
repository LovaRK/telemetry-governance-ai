export interface ConnectionInput {
  mcp_url: string;
  token: string;
}

export interface ConnectionOutput {
  status: 'CONNECTED' | 'DEGRADED' | 'AUTH_FAILED' | 'NO_INDEX_ACCESS' | 'NO_DATA' | 'PARTIAL_DATA';
  indexes: string[];
  sources: number;
  latency_ms: number;
  capabilities: {
    search: boolean;
    stats: boolean;
  };
  error?: string;
  schema_version: string;
}