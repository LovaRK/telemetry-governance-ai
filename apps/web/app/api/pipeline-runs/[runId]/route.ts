import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { ensurePipelineLedgerSchema, getRunById, getRunMetrics } from '@/lib/pipeline-ledger-service';

export const GET = createRoute(async (request: NextRequest, context: { params: Promise<{ runId: string }> }) => {
  // Require authentication: fail-closed if missing tenant context
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const ctx = ctxOrError;
  const tenantId = ctx.tenantId;

  await ensurePipelineLedgerSchema();

  const { runId } = await context.params;
  const run = await getRunById(runId);
  if (!run) {
    return NextResponse.json(
      { error: 'Run not found' },
      { status: 404 }
    );
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
