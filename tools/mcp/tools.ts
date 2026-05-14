import { MCPTool } from './types';

export const mcpTools: MCPTool[] = [
  {
    name: 'search',
    description: 'Execute a Splunk search query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SPL query' },
        earliest: { type: 'string', description: 'Earliest time' },
        latest: { type: 'string', description: 'Latest time' },
        limit: { type: 'number', description: 'Max results', default: 100 }
      },
      required: ['query']
    }
  },
  {
    name: 'get_indexes',
    description: 'List all available indexes',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_stats',
    description: 'Get index statistics',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'string', description: 'Index name' }
      }
    }
  },
  {
    name: 'get_volume',
    description: 'Get volume statistics by sourcetype',
    inputSchema: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', description: 'Time range', default: '24h' }
      }
    }
  }
];