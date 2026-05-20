import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export const GET = createRoute(async (request: Request) => {
  if (!process.env.DATABASE_URL) {
    throw new Error('Database not available');
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const indexName = searchParams.get('indexName');

  let whereClause = '';
  let params: any[] = [];

  if (indexName) {
    whereClause = 'WHERE index_name = $1';
    params.push(indexName);
  }

  const res = await query(
    `SELECT
      id,
      snapshot_id,
      snapshot_date,
      index_name,
      tier_previous,
      tier_current,
      action_previous,
      action_current,
      confidence_changed,
      score_delta,
      change_reason,
      created_at
    FROM decision_history
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const decisions = (res.rows || []).map((d: any) => ({
    id: d.id,
    snapshotId: d.snapshot_id,
    snapshotDate: d.snapshot_date,
    indexName: d.index_name,
    tierPrevious: d.tier_previous,
    tierCurrent: d.tier_current,
    actionPrevious: d.action_previous,
    actionCurrent: d.action_current,
    confidenceChanged: d.confidence_changed,
    scoreDelta: parseFloat(d.score_delta) || null,
    changeReason: d.change_reason,
    createdAt: d.created_at,
  }));

  return {
    data: decisions,
    meta: { source: 'postgres' },
  };
});
