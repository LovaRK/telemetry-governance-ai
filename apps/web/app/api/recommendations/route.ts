import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

// GET /api/recommendations?snapshotId=...
// Returns all recommendation_actions for a snapshot, joined with agent_decisions
export const GET = createRoute(async (request: NextRequest) => {
  const tenantId = request.headers.get('x-tenant-id');
  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get('snapshotId');

  const result = await query<any>(`
    SELECT
      ra.id,
      ra.decision_id,
      ra.snapshot_id,
      ra.index_name,
      ra.status,
      ra.actor_email,
      ra.actor_role,
      ra.action_note,
      ra.escalate_to,
      ra.created_at,
      ra.updated_at,
      -- Agent decision data
      d.tier,
      d.action          AS ai_action,
      d.confidence,
      d.confidence_score,
      d.recommendation,
      d.reasoning,
      d.estimated_savings,
      d.is_quick_win,
      d.candidate_reason
    FROM recommendation_actions ra
    LEFT JOIN agent_decisions d
      ON d.id = ra.decision_id
    WHERE
      (ra.tenant_id = $1 OR $1 IS NULL)
      ${snapshotId ? 'AND ra.snapshot_id = $2' : ''}
    ORDER BY
      CASE ra.status
        WHEN 'NEW'          THEN 1
        WHEN 'UNDER_REVIEW' THEN 2
        WHEN 'ESCALATED'    THEN 3
        WHEN 'APPROVED'     THEN 4
        WHEN 'DEFERRED'     THEN 5
        WHEN 'REJECTED'     THEN 6
        WHEN 'IMPLEMENTED'  THEN 7
        WHEN 'ROLLED_BACK'  THEN 8
      END,
      ra.updated_at DESC
  `, snapshotId ? [tenantId, snapshotId] : [tenantId]);

  return {
    data: { recommendations: result.rows },
    meta: { source: 'postgres' },
  };
});
