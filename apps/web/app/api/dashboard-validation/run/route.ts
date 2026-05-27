import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { runDashboardValidation } from '@api/services/dashboard-validation-service';

export const POST = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;
  const body = await request.json().catch(() => ({}));
  const forceMismatch = Boolean(body?.forceMismatch);

  const result = await runDashboardValidation(tenantId, forceMismatch);
  return {
    data: result,
    meta: { source: 'postgres', tenantId },
  };
});

