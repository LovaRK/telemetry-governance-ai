import { MCPClient } from '../../tools/mcp/client';
import { ConnectionInput, ConnectionOutput } from './types';

export async function runConnectionAgent(input: ConnectionInput): Promise<ConnectionOutput> {
  const client = new MCPClient({ url: input.mcp_url, token: input.token });
  const state = await client.checkConnection();

  return {
    ...state,
    schema_version: 'v1'
  };
}