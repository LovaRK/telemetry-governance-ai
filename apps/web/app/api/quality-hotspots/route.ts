import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export const GET = createRoute(async () => {
  const res = await query(`
    SELECT sourcetype, issue_count, quality_score, estimated_impact
    FROM quality_hotspots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM quality_hotspots)
    ORDER BY quality_score ASC, issue_count DESC
    LIMIT 100
  `);
  return {
    data: res.rows || [],
    meta: { source: 'postgres' },
  };
});
