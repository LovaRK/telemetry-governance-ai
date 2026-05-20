import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

const VALID_STATUSES = [
  'NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED',
  'DEFERRED', 'ESCALATED', 'IMPLEMENTED', 'ROLLED_BACK',
] as const;

type RecommendationStatus = typeof VALID_STATUSES[number];

// PATCH /api/recommendations/[id]
// Body: { status, note?, escalateTo? }
export const PATCH = createRoute(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  const actorUserId = request.headers.get('x-user-id');
  const actorRole   = request.headers.get('x-user-role');
  const tenantId    = request.headers.get('x-tenant-id');

  const body = await request.json();
  const { status, note, escalateTo, actorEmail } = body;

  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Fetch current state for audit
  const current = await query<any>(
    `SELECT id, status, index_name, snapshot_id, tenant_id
     FROM recommendation_actions WHERE id = $1`,
    [params.id]
  );

  if (current.rows.length === 0) {
    throw new Error('Recommendation not found');
  }

  const rec = current.rows[0];
  const fromStatus = rec.status as RecommendationStatus;

  // Update the recommendation status
  const updated = await query<any>(`
    UPDATE recommendation_actions SET
      status       = $1,
      actor_user_id = $2,
      actor_email  = $3,
      actor_role   = $4,
      action_note  = $5,
      escalate_to  = $6,
      updated_at   = NOW()
    WHERE id = $7
    RETURNING *
  `, [
    status,
    actorUserId,
    actorEmail || null,
    actorRole,
    note || null,
    escalateTo || null,
    params.id,
  ]);

  // Write immutable audit log entry
  await query(`
    INSERT INTO recommendation_audit_log (
      action_id, snapshot_id, index_name, tenant_id,
      from_status, to_status,
      actor_user_id, actor_email, note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    params.id,
    rec.snapshot_id,
    rec.index_name,
    rec.tenant_id || tenantId,
    fromStatus,
    status,
    actorUserId,
    actorEmail || null,
    note || null,
  ]);

  return {
    data: {
      success: true,
      recommendation: updated.rows[0],
      transition: { from: fromStatus, to: status },
    },
    meta: { source: 'postgres' },
  };
});

// GET /api/recommendations/[id] — fetch single recommendation with audit trail
export const GET = createRoute(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  const [rec, audit] = await Promise.all([
    query<any>(
      `SELECT ra.*, d.tier, d.action as ai_action, d.confidence, d.recommendation,
              d.reasoning, d.estimated_savings, d.is_quick_win, d.candidate_reason
       FROM recommendation_actions ra
       LEFT JOIN agent_decisions d ON d.id = ra.decision_id
       WHERE ra.id = $1`,
      [params.id]
    ),
    query<any>(
      `SELECT * FROM recommendation_audit_log
       WHERE action_id = $1
       ORDER BY created_at ASC`,
      [params.id]
    ),
  ]);

  if (rec.rows.length === 0) {
    throw new Error('Not found');
  }

  return {
    data: {
      recommendation: rec.rows[0],
      auditTrail: audit.rows,
    },
    meta: { source: 'postgres' },
  };
});
