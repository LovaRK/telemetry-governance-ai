import { createRoute } from '@/lib/api-route-factory';
import { getCacheStatus } from '@api/services/cache-service';
import { query } from '@core/database/connection';

export const GET = createRoute(async () => {
  // Check cache metadata status
  const cacheMetadata = await getCacheStatus('index_metrics');
  // Check if there's data in the database FIRST
  const countResult = await query(`SELECT COUNT(*) as count FROM telemetry_snapshots`);
  const recordCount = parseInt(countResult.rows[0]?.count || '0', 10);
  const hasData = recordCount > 0;

  // hasEverRefreshed requires BOTH a prior refresh status AND actual data existing
  // getCacheStatus returns 'stale' for empty cache — that must not count as refreshed
  const hasEverRefreshed = hasData && (cacheMetadata.status === 'fresh' || cacheMetadata.status === 'stale' || cacheMetadata.status === 'fast_complete');

  // Check if there are agent decisions
  const decisionsResult = await query(`SELECT COUNT(*) as count FROM agent_decisions`);
  const decisionCount = parseInt(decisionsResult.rows[0]?.count || '0', 10);
  const hasAgentDecisions = decisionCount > 0;

  return {
    data: {
      hasEverRefreshed,
      hasData,
      hasAgentDecisions,
      status: cacheMetadata.status,
      lastRefreshAt: cacheMetadata.lastRefreshAt,
      nextRefreshAt: cacheMetadata.nextRefreshAt,
      recordCount,
      message: hasEverRefreshed ? 'Cache is ready' : 'Awaiting first refresh',
    },
    meta: { source: 'postgres' },
  };
});
