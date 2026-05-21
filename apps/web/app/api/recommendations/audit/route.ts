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

  if (!indexName) {
    throw new Error('index parameter required');
  }

  try {
    // Primary source: recommendation_audit_log joined to actions
    const res = await query<any>(
      `SELECT
        ral.id,
        ral.from_status,
        ral.to_status,
        ral.actor_email,
        ral.note,
        ral.created_at
       FROM recommendation_audit_log ral
       JOIN recommendation_actions ra ON ral.action_id = ra.id
       WHERE ra.index_name = $1
       ORDER BY ral.created_at ASC`,
      [indexName]
    );

    return {
      data: {
        index: indexName,
        sourcetype: null,
        audit: res.rows || [],
        count: res.rows?.length || 0,
      },
      meta: { source: 'postgres' },
    };
  } catch (e) {
    // Fallback: use recommendation_actions timeline directly
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
       ORDER BY updated_at ASC`,
      [indexName]
    );

    return {
      data: {
        index: indexName,
        sourcetype: null,
        audit: res.rows || [],
        count: res.rows?.length || 0,
      },
      meta: { source: 'postgres' },
    };
  }
});
