import { createRoute } from '@/lib/api-route-factory';
import { getJobStatus } from '@api/services/job-service';

export const dynamic = 'force-dynamic';

export const GET = createRoute(async (_req: Request, context: { params: Promise<{ jobId: string }> }) => {
  const { jobId } = await context.params;
  const job = await getJobStatus(jobId);
  return {
    data: job,
    meta: { source: 'system' },
  };
});
