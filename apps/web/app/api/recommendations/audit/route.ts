import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

/**
 * GET /api/recommendations/audit?index=<name>&sourcetype=<st>
 *
 * Returns the full governance audit trail for a specific index/sourcetype pair.
 * Used by the AuditTimeline component in DecisionExplainabilityPanel.
 */
export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const indexName = searchParams.get('index');
  const sourcetype = searchParams.get('sourcetype') || null;

  if (!indexName) {
    throw new Error('index parameter required');
  }

  try {
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

    return {
      data: {
        index: indexName,
        sourcetype,
        audit: res.rows || [],
        count: res.rows?.length || 0,
      },
      meta: { source: 'postgres' },
    };
  } catch (e) {
    // Fallback: try the recommendation_actions table directly (no separate audit table)
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

    return {
      data: {
        index: indexName,
        sourcetype,
        audit: res.rows || [],
        count: res.rows?.length || 0,
      },
      meta: { source: 'postgres' },
    };
  }
});
