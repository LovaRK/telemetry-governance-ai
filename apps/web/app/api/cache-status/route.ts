import { NextResponse } from 'next/server';
import { getCacheStatus } from '@api/services/cache-service';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    // Check cache metadata status
    const cacheMetadata = await getCacheStatus('index_metrics');
    const hasEverRefreshed = cacheMetadata.status === 'fresh' || cacheMetadata.status === 'stale';

    // Check if there's data in the database
    const countResult = await query(`SELECT COUNT(*) as count FROM telemetry_snapshots`);
    const recordCount = parseInt(countResult.rows[0]?.count || '0', 10);
    const hasData = recordCount > 0;

    // Check if there are agent decisions
    const decisionsResult = await query(`SELECT COUNT(*) as count FROM agent_decisions`);
    const decisionCount = parseInt(decisionsResult.rows[0]?.count || '0', 10);
    const hasAgentDecisions = decisionCount > 0;

    return NextResponse.json({
      hasEverRefreshed,
      hasData,
      hasAgentDecisions,
      status: cacheMetadata.status,
      lastRefreshAt: cacheMetadata.lastRefreshAt,
      nextRefreshAt: cacheMetadata.nextRefreshAt,
      recordCount,
      message: hasEverRefreshed ? 'Cache is ready' : 'Awaiting first refresh',
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        hasEverRefreshed: false,
        hasData: false,
        hasAgentDecisions: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'Database query failed',
      },
      { status: 500 }
    );
  }
}
