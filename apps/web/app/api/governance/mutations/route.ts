import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

/**
 * GET /api/governance/mutations
 * Returns recent governance mutation journal entries.
 */
export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 1000);
  const index = searchParams.get('index');
  const since = searchParams.get('since');

  const conditions: string[] = [];
  const params: any[] = [];

  if (index) { params.push(index); conditions.push(`index_name = $${params.length}`); }
  if (since) { params.push(since); conditions.push(`recorded_at >= $${params.length}`); }

  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await query<any>(
    `SELECT event_id, index_name, event_type, action_intent,
            from_state, to_state, reviewer_id, trace_id, recorded_at
     FROM governance_mutation_journal
     ${where}
     ORDER BY recorded_at DESC LIMIT $${params.length}`,
    params
  );

  const rows = res.rows || [];

  return {
    data: {
      summary: {
        total: rows.length,
        mutationTypes: rows.reduce((acc: Record<string, number>, r: any) => {
          acc[r.event_type] = (acc[r.event_type] || 0) + 1;
          return acc;
        }, {}),
      },
      mutations: rows.map((r: any) => ({
        id: r.event_id,
        indexName: r.index_name,
        mutationType: r.event_type,
        actionIntent: r.action_intent,
        fromState: r.from_state,
        toState: r.to_state,
        actorEmail: r.reviewer_id,
        traceId: r.trace_id,
        recordedAt: r.recorded_at,
      })),
      lastUpdate: new Date().toISOString(),
    },
    meta: { source: 'postgres' },
  };
});

/**
 * POST /api/governance/mutations
 * Record a governance action (approve/reject quick-wins, etc.)
 * Maps to recommendation_actions for simple approve/reject flows.
 */
export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const { indexName, sourcetype, mutationType, actorEmail, actionNote, idempotencyKey } = body;

  if (!indexName || !mutationType) {
    throw new Error('indexName and mutationType are required');
  }

  // Upsert into recommendation_actions — this is the primary governance ledger
  // The quick-win approve uses this to record the decision.
  const statusMap: Record<string, string> = {
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    DEFER: 'DEFERRED',
    ESCALATE: 'ESCALATED',
  };
  const status = statusMap[mutationType] || mutationType;

  // Check idempotency via recommendation_actions
  if (idempotencyKey) {
    const existing = await query<any>(
      `SELECT id FROM recommendation_actions WHERE action_note = $1 AND index_name = $2 LIMIT 1`,
      [idempotencyKey, indexName]
    );
    if (existing.rows.length > 0) {
      return {
        data: { ok: true, idempotent: true, id: existing.rows[0].id },
        meta: { source: 'postgres' },
      };
    }
  }

  // Get the latest snapshot_id for this index
  const snapRes = await query<any>(
    `SELECT snapshot_id FROM agent_decisions WHERE index_name = $1 ORDER BY created_at DESC LIMIT 1`,
    [indexName]
  );
  const snapshotId = snapRes.rows[0]?.snapshot_id || '00000000-0000-0000-0000-000000000000';

  const res = await query<any>(
    `INSERT INTO recommendation_actions
       (index_name, snapshot_id, status, actor_email, action_note, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id`,
    [indexName, snapshotId, status, actorEmail || null, actionNote || idempotencyKey || null]
  );

  return {
    data: { ok: true, id: res.rows[0]?.id },
    meta: { source: 'postgres' },
  };
});
