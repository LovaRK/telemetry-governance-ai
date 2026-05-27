import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { getValidationRunById } from '@api/services/dashboard-validation-service';

export const GET = createRoute(async (request: NextRequest, context: { params: Promise<{ runId: string }> }) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;
  const { runId } = await context.params;

  const data = await getValidationRunById(tenantId, runId);
  if (!data) return NextResponse.json({ error: 'Validation run not found' }, { status: 404 });
  return { data, meta: { source: 'postgres', tenantId } };
});

