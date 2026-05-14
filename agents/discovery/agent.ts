import { MCPClient } from '../../tools/mcp/client';
import { DiscoveryInput, DiscoveryOutput } from './types';

export async function runDiscoveryAgent(input: DiscoveryInput): Promise<DiscoveryOutput> {
  const { connection } = input;

  if (connection.status !== 'CONNECTED' && connection.status !== 'DEGRADED') {
    return {
      high_volume_sources: [],
      error_sources: [],
      critical_indexes: [],
      telemetry_summary: { total_indexes: 0, total_sources: 0, daily_gb_estimate: 0 },
      schema_version: 'v1'
    };
  }

  const client = new MCPClient({ url: '', token: '' });

  const volumeResult = await client.callTool('get_volume', { timeframe: '24h' });
  const statsResult = await client.callTool('get_stats', {});

  const highVolumeSources: string[] = [];
  const errorSources: string[] = [];
  const criticalIndexes: string[] = [];

  if (volumeResult.success && Array.isArray(volumeResult.data)) {
    const sorted = [...volumeResult.data].sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0));
    highVolumeSources.push(...sorted.slice(0, 10).map((s: any) => s.sourcetype));

    errorSources.push(...sorted.filter((s: any) => s.error_rate > 0.1).map((s: any) => s.sourcetype));
  }

  if (connection.indexes.includes('security')) {
    criticalIndexes.push('security');
  }
  if (connection.indexes.includes('infrastructure')) {
    criticalIndexes.push('infrastructure');
  }

  const dailyGB = volumeResult.success && volumeResult.data ? (volumeResult.data as any[]).reduce((sum: number, s: any) => sum + (s.volume || 0), 0) : 0;

  return {
    high_volume_sources: highVolumeSources,
    error_sources: errorSources,
    critical_indexes: criticalIndexes,
    telemetry_summary: {
      total_indexes: connection.indexes.length,
      total_sources: connection.sources,
      daily_gb_estimate: Math.round(dailyGB)
    },
    schema_version: 'v1'
  };
}