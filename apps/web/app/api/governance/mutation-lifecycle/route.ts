import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

/**
 * GET /api/governance/mutation-lifecycle
 *
 * Returns the mutation lifecycle event log — every state transition for
 * governance decisions with full provenance (who, when, from→to).
 *
 * Query params:
 *   limit      (default 100)
 *   index      (optional)
 *   fromState  (optional, filter by originating state)
 *   toState    (optional, filter by destination state)
 */
export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 1000);
  const indexFilter = searchParams.get('index');
  const fromState = searchParams.get('fromState');
  const toState   = searchParams.get('toState');

  const conditions: string[] = [];
  const params: any[] = [];

  if (indexFilter) { params.push(indexFilter);  conditions.push(`index_name = $${params.length}`); }
  if (fromState)   { params.push(fromState);    conditions.push(`from_state = $${params.length}`); }
  if (toState)     { params.push(toState);      conditions.push(`to_state = $${params.length}`); }

  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await query<any>(
    `SELECT id, index_name, sourcetype, from_state, to_state, transition_reason,
            actor_id, actor_email, session_id, trace_id, duration_ms, recorded_at
     FROM mutation_lifecycle_events
     ${where}
     ORDER BY recorded_at DESC LIMIT $${params.length}`,
    params
  );

  const rows = res.rows || [];

  // Compute transition frequency map
  const transitionCounts: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.from_state}→${r.to_state}`;
    transitionCounts[key] = (transitionCounts[key] || 0) + 1;
  }

  return {
    data: {
      summary: {
        totalTransitions: rows.length,
        uniqueIndexes: new Set(rows.map((r: any) => r.index_name)).size,
        transitionFrequency: transitionCounts,
      },
      events: rows.map((r: any) => ({
        id: r.id,
        indexName: r.index_name,
        sourcetype: r.sourcetype,
        fromState: r.from_state,
        toState: r.to_state,
        transitionReason: r.transition_reason,
        actorId: r.actor_id,
        actorEmail: r.actor_email,
        sessionId: r.session_id,
        traceId: r.trace_id,
        durationMs: r.duration_ms,
        recordedAt: r.recorded_at,
      })),
      lastUpdate: new Date().toISOString(),
    },
    meta: { source: 'postgres' },
  };
});

/** POST — record a new mutation lifecycle event */
export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const { indexName, sourcetype, fromState, toState, transitionReason, actorEmail, sessionId, traceId, durationMs } = body;

  if (!indexName || !fromState || !toState) {
    throw new Error('indexName, fromState, toState are required');
  }

  await query(
    `INSERT INTO mutation_lifecycle_events
       (index_name, sourcetype, from_state, to_state, transition_reason, actor_email, session_id, trace_id, duration_ms, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [indexName, sourcetype || null, fromState, toState, transitionReason || null, actorEmail || null, sessionId || null, traceId || null, durationMs || null]
  );

  return {
    data: { ok: true },
    meta: { source: 'postgres' },
  };
});
