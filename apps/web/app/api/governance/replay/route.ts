import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

/**
 * GET /api/governance/replay
 *
 * Audit replay — time-travel view of governance decisions at a specific point in time.
 * Returns the state of all decisions as they existed at `asOf` date.
 *
 * Query params:
 *   asOf     ISO date string (required) — replay point in time
 *   index    (optional) — filter to one index
 *   limit    (default 200)
 */
export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const asOf  = searchParams.get('asOf');
  const index = searchParams.get('index');
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 1000);

  if (!asOf) {
    throw new Error('asOf parameter required (ISO date string)');
  }

  const asOfDate = new Date(asOf);
  if (isNaN(asOfDate.getTime())) {
    throw new Error('Invalid asOf date');
  }

  // Use governance_replay_journal if populated; fall back to agent_decisions snapshot
  const params: any[] = [asOfDate.toISOString(), limit];
  const indexWhere = index ? `AND index_name = $3` : '';
  if (index) params.push(index);

  let res = await query<any>(
    `SELECT replay_id, index_name, sourcetype, snapshot_state, recorded_at, replay_source
     FROM governance_replay_journal
     WHERE recorded_at <= $1 ${indexWhere}
     ORDER BY recorded_at DESC LIMIT $2`,
    params
  );

  // Fallback: use agent_decisions + recommendation_actions as replay source
  if (res.rows.length === 0) {
    const fallbackParams: any[] = [asOfDate.toISOString(), limit];
    const fallbackWhere = index ? `AND ad.index_name = $3` : '';
    if (index) fallbackParams.push(index);

    res = await query<any>(
      `SELECT
         ad.id           AS replay_id,
         ad.index_name,
         ad.sourcetype,
         jsonb_build_object(
           'tier',            ad.tier,
           'action',          ad.action,
           'compositeScore',  ad.composite_score,
           'confidence',      ad.confidence_score,
           'govStatus',       COALESCE(ra.status, 'NEW'),
           'govNote',         ra.action_note,
           'govActor',        ra.actor_email
         ) AS snapshot_state,
         ad.created_at AS recorded_at,
         'agent_decisions'   AS replay_source
       FROM agent_decisions ad
       LEFT JOIN LATERAL (
         SELECT status, action_note, actor_email
         FROM recommendation_actions
         WHERE index_name = ad.index_name
           AND (sourcetype = ad.sourcetype OR (sourcetype IS NULL AND ad.sourcetype IS NULL))
           AND updated_at <= $1
         ORDER BY updated_at DESC LIMIT 1
       ) ra ON true
       WHERE ad.created_at <= $1 ${fallbackWhere}
       ORDER BY ad.composite_score DESC LIMIT $2`,
      fallbackParams
    );
  }

  return {
    data: {
      asOf: asOfDate.toISOString(),
      indexFilter: index || null,
      count: res.rows.length,
      snapshot: res.rows.map((r: any) => ({
        replayId: r.replay_id,
        indexName: r.index_name,
        sourcetype: r.sourcetype,
        state: typeof r.snapshot_state === 'string' ? JSON.parse(r.snapshot_state) : r.snapshot_state,
        recordedAt: r.recorded_at,
        source: r.replay_source,
      })),
    },
    meta: { source: 'postgres' },
  };
});

/** POST — checkpoint current state into replay journal (called after each aggregation run) */
export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const { indexName, sourcetype, snapshotState } = body;

  if (!indexName || !snapshotState) {
    throw new Error('indexName and snapshotState required');
  }

  await query(
    `INSERT INTO governance_replay_journal (index_name, sourcetype, snapshot_state, replay_source, recorded_at)
     VALUES ($1, $2, $3::jsonb, 'api_checkpoint', NOW())`,
    [indexName, sourcetype || null, JSON.stringify(snapshotState)]
  );

  return {
    data: { ok: true },
    meta: { source: 'postgres' },
  };
});
