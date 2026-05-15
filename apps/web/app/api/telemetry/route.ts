import { NextRequest, NextResponse } from 'next/server';
import { getSnapshots, getKpiMetrics, TelemetryFilters } from '@api/repositories/telemetry-repository';

export async function GET(request: NextRequest) {
  try {
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
      return NextResponse.json(
        { error: 'Telemetry query failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      snapshots,
      kpis,
      count: snapshots.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch telemetry' },
      { status: 500 }
    );
  }
}
