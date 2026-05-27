import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { getExplainabilityForTenant } from '@api/services/kpi-explainability-service';

export const GET = createRoute(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;
  const { id } = await context.params;
  const normalized = String(id || '').toUpperCase();

  const explain = await getExplainabilityForTenant(tenantId);
  const row = explain.find((r) => r.metricId === normalized);
  if (!row) {
    return NextResponse.json({ error: `KPI trace not found for id=${id}` }, { status: 404 });
  }

  return {
    data: row,
    meta: { source: 'postgres', tenantId },
  };
});

