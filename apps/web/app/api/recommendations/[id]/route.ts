import { NextRequest, NextResponse } from 'next/server';
import { query } from '@core/database/connection';

const VALID_STATUSES = [
  'NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED',
  'DEFERRED', 'ESCALATED', 'IMPLEMENTED', 'ROLLED_BACK',
] as const;

type RecommendationStatus = typeof VALID_STATUSES[number];

// PATCH /api/recommendations/[id]
// Body: { status, note?, escalateTo? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actorUserId = request.headers.get('x-user-id');
    const actorRole   = request.headers.get('x-user-role');
    const tenantId    = request.headers.get('x-tenant-id');

    const body = await request.json();
    const { status, note, escalateTo, actorEmail } = body;

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // Fetch current state for audit
    const current = await query<any>(
      `SELECT id, status, index_name, snapshot_id, tenant_id
       FROM recommendation_actions WHERE id = $1`,
      [params.id]
    );

    if (current.rows.length === 0) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
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

    return NextResponse.json({
      success: true,
      recommendation: updated.rows[0],
      transition: { from: fromStatus, to: status },
    });
  } catch (error) {
    console.error('[recommendations PATCH]', error);
    return NextResponse.json({ error: 'Failed to update recommendation' }, { status: 500 });
  }
}

// GET /api/recommendations/[id] — fetch single recommendation with audit trail
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      recommendation: rec.rows[0],
      auditTrail: audit.rows,
    });
  } catch (error) {
    console.error('[recommendations GET single]', error);
    return NextResponse.json({ error: 'Failed to fetch recommendation' }, { status: 500 });
  }
}
