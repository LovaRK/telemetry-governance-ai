import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export const GET = createRoute(async () => {
  const res = await query(`
    SELECT sourcetype, fields_indexed, fields_used, optimization_pct
    FROM field_usage
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM field_usage)
    ORDER BY optimization_pct ASC, sourcetype
    LIMIT 100
  `);
  return {
    data: res.rows || [],
    meta: { source: 'postgres' },
  };
});
