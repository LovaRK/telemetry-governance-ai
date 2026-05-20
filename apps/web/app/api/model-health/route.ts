import { createRoute } from '@/lib/api-route-factory';
import { transaction } from '@core/database/connection';
import { calculateModelTrustScore } from '@api/services/trust-decay-service';

export const GET = createRoute(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('Database not available');
  }

  const snapshotDate = new Date().toISOString().split('T')[0];

  let data = null;

  await transaction(async (client: any) => {
    data = await calculateModelTrustScore(client, snapshotDate);
  });

  return {
    data,
    meta: { source: 'postgres', timestamp: new Date().toISOString() },
  };
});
