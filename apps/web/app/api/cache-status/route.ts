import { createRoute } from '@/lib/api-route-factory';
import { getCacheStatus } from '@api/services/cache-service';
import { query } from '@core/database/connection';
import { ensurePipelineLedgerSchema, getLatestPublishedRun, getRunMetrics } from '@/lib/pipeline-ledger-service';
import { NextRequest, NextResponse } from 'next/server';
import { requireContext } from '@packages/auth/request-context';

export const GET = createRoute(async (request: NextRequest) => {
  await ensurePipelineLedgerSchema();

  // Require authentication - this returns tenant-specific data
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;
  const tenantId = context.tenantId;
  // Check cache metadata status
  const cacheMetadata = await getCacheStatus('index_metrics');
  const latestRun = await getLatestPublishedRun(tenantId);
  const runMetrics = latestRun ? await getRunMetrics(latestRun.runId, latestRun.snapshotId, tenantId) : null;

  // Scope readiness flags to the active published snapshot. Historical rows from
  // prior tenants/runs must not enable AI widgets for the current dashboard.
  const snapshotsResult = latestRun
    ? await query(
        `SELECT COUNT(*) as count
         FROM telemetry_snapshots
         WHERE tenant_id = $1 AND snapshot_id = $2`,
        [tenantId, latestRun.snapshotId]
      )
    : { rows: [{ count: '0' }] };
  const recordCount = parseInt(snapshotsResult.rows[0]?.count || '0', 10);
  const hasData = recordCount > 0;

  const decisionCount = runMetrics?.decisionCount || 0;
  const hasAgentDecisions = decisionCount > 0;

  const kpisResult = latestRun
    ? await query(
        `SELECT COUNT(*) as count
         FROM executive_kpis
         WHERE tenant_id = $1 AND snapshot_id = $2`,
        [tenantId, latestRun.snapshotId]
      )
    : { rows: [{ count: '0' }] };
  const kpiCount = parseInt(kpisResult.rows[0]?.count || '0', 10);
  const hasKpis = kpiCount > 0;

  // Source of truth for "has refreshed" is materialized data. Cache metadata can be
  // transiently "refreshing" while data is already available for detail views.
  const hasEverRefreshed = hasData || hasAgentDecisions || hasKpis;
  return {
    data: {
      hasEverRefreshed,
      hasData,
      hasAgentDecisions,
      hasKpis,
      status: latestRun?.published ? 'fresh' : cacheMetadata.status,
      lastRefreshAt: cacheMetadata.lastRefreshAt,
      nextRefreshAt: cacheMetadata.nextRefreshAt,
      recordCount,
      runId: latestRun?.runId || null,
      snapshotId: latestRun?.snapshotId || null,
      publishedAt: latestRun?.publishedAt || null,
      decisionCount: runMetrics?.decisionCount || 0,
      dailyAvgGb: runMetrics?.dailyAvgGb || 0,
      message: hasEverRefreshed ? 'Cache is ready' : 'Awaiting first refresh',
    },
    meta: { source: 'postgres' },
  };
});
