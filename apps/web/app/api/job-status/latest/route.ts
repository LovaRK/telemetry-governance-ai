import { createRoute } from '@/lib/api-route-factory';
import { getLatestJob } from '@api/services/job-service';
import { NextRequest, NextResponse } from 'next/server';
import { requireContext } from '@packages/auth/request-context';

export const dynamic = 'force-dynamic';

export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }

  const context = ctxOrError;
  const job = await getLatestJob(undefined, context);
  return {
    data: job,
    meta: { source: 'system' },
  };
});
