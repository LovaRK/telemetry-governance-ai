import { createRoute } from '@/lib/api-route-factory';
import { getTrustInspectionPayload } from '@api/services/trust-inspection-service';

export const GET = createRoute(async (request: Request) => {
  const indexName = new URL(request.url).searchParams.get('indexName');

  if (!indexName) {
    throw new Error('Missing required parameter: indexName');
  }

  // Check if service is available
  if (!process.env.DATABASE_URL) {
    throw new Error('Trust inspection not available: Run in full-stack mode with DATABASE_URL set');
  }

  const payload = await getTrustInspectionPayload(indexName);
  return {
    data: payload,
    meta: { source: 'postgres' },
  };
});
