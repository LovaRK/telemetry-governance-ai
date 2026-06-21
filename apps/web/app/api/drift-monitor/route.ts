import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export const GET = createRoute(async (request: Request) => {
  const limit = new URL(request.url).searchParams.get('limit') || '50';

  // Check if database is available
  if (!process.env.DATABASE_URL) {
    throw new Error('Database not available');
  }

  // Fetch recent drift events
  const result = await query(
    `SELECT
      ddh.index_name,
      ddh.drift_severity as drift_status,
      NULL::numeric as severity_score,
      ddh.drift_reason,
      ddh.evaluated_at,
      ad.confidence_score,
      CASE WHEN rjq.job_id IS NOT NULL THEN true ELSE false END as is_queued_for_reanalysis,
      rjq.priority_tier
    FROM decision_drift_history ddh
    LEFT JOIN agent_decisions ad ON ddh.index_name = ad.index_name
    LEFT JOIN reanalysis_job_queue rjq ON ddh.index_name = rjq.index_name
      AND rjq.execution_state IN ('QUEUED', 'PENDING', 'PROCESSING')
    WHERE ddh.drift_severity IN ('NOISE', 'METRIC', 'SEMANTIC', 'POLICY')
    ORDER BY
      CASE ddh.drift_severity
        WHEN 'POLICY' THEN 1
        WHEN 'SEMANTIC' THEN 2
        WHEN 'METRIC' THEN 3
        WHEN 'NOISE' THEN 4
      END ASC,
      ddh.evaluated_at DESC
    LIMIT $1`,
    [parseInt(limit)]
  );

  // Map severity levels to match frontend expectations
  const severityMap: Record<string, string> = {
    'NOISE': 'NOISE',
    'METRIC': 'METRIC_DRIFT',
    'SEMANTIC': 'SEMANTIC_DRIFT',
    'POLICY': 'POLICY_DRIFT',
  };

  const driftEvents = result.rows.map((row: any) => ({
    index_name: row.index_name,
    drift_status: severityMap[row.drift_status] || 'STABLE',
    severity_score: parseFloat(row.severity_score) || 0,
    drift_reason: row.drift_reason || 'Drift detected',
    evaluated_at: row.evaluated_at,
    confidence_score: parseFloat(row.confidence_score) || 0.5,
    is_queued_for_reanalysis: row.is_queued_for_reanalysis,
    priority_tier: row.priority_tier,
  }));

  return {
    data: {
      driftEvents,
      count: driftEvents.length,
    },
    meta: { source: 'postgres' },
  };
});
