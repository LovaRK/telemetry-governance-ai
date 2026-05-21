import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { ensurePipelineLedgerSchema, getRunById, getRunMetrics } from '@/lib/pipeline-ledger-service';

export const GET = createRoute(async (request: NextRequest, context: { params: Promise<{ runId: string }> }) => {
  await ensurePipelineLedgerSchema();
  const tenantId = request.headers.get('x-tenant-id') || 'default';
  const { runId } = await context.params;
  const run = await getRunById(runId);
  if (!run) throw new Error('Run not found');
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
