import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { getExplainabilityForTenant } from '@api/services/kpi-explainability-service';

export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;

  const explain = await getExplainabilityForTenant(tenantId);
  return {
    data: explain,
    meta: { source: 'postgres', tenantId },
  };
});

