import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { getKpiHistory } from '@api/services/kpi-history-service';

export const GET = createRoute(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;

  const { id } = await context.params;
  const data = await getKpiHistory(ctxOrError.tenantId, id);
  if (!data) return NextResponse.json({ error: 'KPI not found' }, { status: 404 });

  return { data, meta: { source: 'postgres', tenantId: ctxOrError.tenantId } };
});
