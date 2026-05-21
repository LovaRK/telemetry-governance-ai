import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { ensurePipelineLedgerSchema, getLatestPublishedRun, getRunMetrics } from '@/lib/pipeline-ledger-service';

export const GET = createRoute(async (request: NextRequest) => {
  await ensurePipelineLedgerSchema();
  const tenantId = request.headers.get('x-tenant-id') || 'default';
  const run = await getLatestPublishedRun(tenantId);
  if (!run) {
    return { data: null, meta: { source: 'postgres', tenantId } };
  }
  const metrics = await getRunMetrics(run.runId, run.snapshotId, tenantId);
  return {
    data: {
      runId: run.runId,
      snapshotId: run.snapshotId,
      splunkBytes: metrics.splunkBytes,
      dailyAvgGb: metrics.dailyAvgGb,
      decisionCount: metrics.decisionCount,
      published: run.published,
      status: run.status,
      tenantId: run.tenantId,
      publishedAt: run.publishedAt,
    },
    meta: { source: 'postgres', tenantId },
  };
});
