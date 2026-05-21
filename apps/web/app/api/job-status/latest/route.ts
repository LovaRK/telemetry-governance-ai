import { createRoute } from '@/lib/api-route-factory';
import { getLatestJob } from '@api/services/job-service';

export const dynamic = 'force-dynamic';

export const GET = createRoute(async () => {
  const job = await getLatestJob();
  return {
    data: job,
    meta: { source: 'system' },
  };
});

