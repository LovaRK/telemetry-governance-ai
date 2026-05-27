import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { getLatestValidationRun } from '@api/services/dashboard-validation-service';

export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;

  const data = await getLatestValidationRun(tenantId);
  return { data, meta: { source: 'postgres', tenantId } };
});

