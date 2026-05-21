import { createRoute } from '@/lib/api-route-factory';
import { getJobStatus } from '@api/services/job-service';

export const dynamic = 'force-dynamic';

export const GET = createRoute(async (_req: Request, { params }: { params: { jobId: string } }) => {
  const job = await getJobStatus(params.jobId);
  return {
    data: job,
    meta: { source: 'system' },
  };
});
