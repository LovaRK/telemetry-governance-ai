import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export const GET = createRoute(async () => {
  const res = await query(`
    SELECT sourcetype, coverage_pct, active_alerts, detection_gaps
    FROM security_coverage
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM security_coverage)
    ORDER BY coverage_pct ASC, sourcetype
    LIMIT 100
  `);

  return {
    data: res.rows || [],
    meta: { source: 'postgres' },
  };
});
