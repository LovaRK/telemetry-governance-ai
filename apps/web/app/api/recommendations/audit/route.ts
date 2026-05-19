import { NextRequest, NextResponse } from 'next/server';
import { query } from '@core/database/connection';

/**
 * GET /api/recommendations/audit?index=<name>&sourcetype=<st>
 *
 * Returns the full governance audit trail for a specific index/sourcetype pair.
 * Used by the AuditTimeline component in DecisionExplainabilityPanel.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const indexName = searchParams.get('index');
    const sourcetype = searchParams.get('sourcetype') || null;

    if (!indexName) {
      return NextResponse.json({ error: 'index parameter required', audit: [] }, { status: 400 });
    }

    // Look up the recommendation_actions audit trail for this index/sourcetype
    const res = await query<any>(
      `SELECT
        raa.id,
        raa.from_status,
        raa.to_status,
        raa.actor_email,
        raa.note,
        raa.created_at
       FROM recommendation_action_audit raa
       JOIN recommendation_actions ra ON raa.recommendation_id = ra.id
       WHERE ra.index_name = $1
         AND (ra.sourcetype = $2 OR ($2 IS NULL AND ra.sourcetype IS NULL))
       ORDER BY raa.created_at ASC`,
      [indexName, sourcetype]
    );

    return NextResponse.json({
      index: indexName,
      sourcetype,
      audit: res.rows || [],
      count: res.rows?.length || 0,
    });
  } catch (e) {
    // Fallback: try the recommendation_actions table directly (no separate audit table)
    try {
      const { searchParams } = new URL(request.url);
      const indexName = searchParams.get('index');
      const sourcetype = searchParams.get('sourcetype') || null;

      const res = await query<any>(
        `SELECT
          id,
          'NEW'    AS from_status,
          status   AS to_status,
          actor_email,
          action_note AS note,
          updated_at  AS created_at
         FROM recommendation_actions
         WHERE index_name = $1
           AND (sourcetype = $2 OR ($2 IS NULL AND sourcetype IS NULL))
         ORDER BY updated_at ASC`,
        [indexName, sourcetype]
      );

      return NextResponse.json({
        index: indexName,
        sourcetype,
        audit: res.rows || [],
        count: res.rows?.length || 0,
      });
    } catch (e2) {
      console.error('[recommendations/audit]', e2);
      return NextResponse.json({ error: 'Failed to fetch audit trail', audit: [] }, { status: 500 });
    }
  }
}
