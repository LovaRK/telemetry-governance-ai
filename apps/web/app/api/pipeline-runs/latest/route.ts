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
      ...run,
      ...metrics,
      durationMs: run.publishedAt ? (new Date(run.publishedAt).getTime() - new Date(run.startedAt).getTime()) : null,
    },
    meta: { source: 'postgres', tenantId },
  };
});
