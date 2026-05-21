import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { ensurePipelineLedgerSchema, getLatestPublishedRun, getRunMetrics } from '@/lib/pipeline-ledger-service';
import { requireContext } from '@packages/auth/request-context';

export const GET = createRoute(async (request: NextRequest) => {
  await ensurePipelineLedgerSchema();

  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;
  const tenantId = context.tenantId;
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
