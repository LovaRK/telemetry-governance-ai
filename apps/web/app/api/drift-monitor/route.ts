import { NextResponse } from 'next/server';

let query: any = null;
try {
  const conn = require('@core/database/connection');
  query = conn.query;
} catch {
  // Database module not available in web-only mode
}

export async function GET(request: Request) {
  const limit = new URL(request.url).searchParams.get('limit') || '50';

  try {
    // Check if database is available
    if (!query || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        driftEvents: [],
      }, { status: 503 });
    }

    // Fetch recent drift events
    const result = await query(
      `SELECT
        ddh.index_name,
        ddh.drift_severity as drift_status,
        ddh.drift_confidence_penalty as severity_score,
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

    return NextResponse.json({
      mode: 'FULL_STACK',
      driftEvents,
      count: driftEvents.length,
    });
  } catch (error) {
    console.error('[Drift Monitor] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        error: 'Failed to fetch drift events',
        details: error instanceof Error ? error.message : String(error),
        driftEvents: [],
      },
      { status: 500 }
    );
  }
}
