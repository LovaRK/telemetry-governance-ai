import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { getSnapshots, getKpiMetrics, TelemetryFilters } from '@api/repositories/telemetry-repository';

// Backward-compatible alias used by dashboard clients.
export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const filters: TelemetryFilters = {
    indexName: searchParams.get('index') || undefined,
    classification: searchParams.get('classification') || undefined,
    granularity: (searchParams.get('granularity') as 'index' | 'sourcetype') || undefined,
    minRiskScore: searchParams.has('minRisk') ? parseFloat(searchParams.get('minRisk')!) : undefined,
    parentIndex: searchParams.get('parentIndex') || undefined,
    limit: searchParams.has('limit') ? parseInt(searchParams.get('limit')!, 10) : 50,
    offset: searchParams.has('offset') ? parseInt(searchParams.get('offset')!, 10) : 0,
  };

  const [snapshots, kpis] = await Promise.all([
    getSnapshots(filters),
    getKpiMetrics(),
  ]);

  if (!snapshots) {
    throw new Error('Telemetry query failed');
  }

  return {
    data: {
      snapshots,
      kpis,
      count: snapshots.length,
    },
    meta: { source: 'postgres' },
  };
});
