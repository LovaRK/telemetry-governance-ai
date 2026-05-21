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

  if (indexFilter) { params.push(indexFilter);  conditions.push(`metadata->>'index_name' = $${params.length}`); }
  if (fromState)   { params.push(fromState);    conditions.push(`previous_state = $${params.length}`); }
  if (toState)     { params.push(toState);      conditions.push(`lifecycle_state = $${params.length}`); }

  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await query<any>(
    `SELECT event_id, correlation_id, lifecycle_state, previous_state,
            state_transition_reason, entered_at, duration_in_state_ms,
            error_code, error_message, triggering_event_id, recorded_at,
            trace_id, span_id, parent_span_id, status, execution_context, metadata
     FROM mutation_lifecycle_events
     ${where}
     ORDER BY recorded_at DESC LIMIT $${params.length}`,
    params
  );

  const rows = res.rows || [];

  // Compute transition frequency map
  const transitionCounts: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.previous_state || 'START'}→${r.lifecycle_state}`;
    transitionCounts[key] = (transitionCounts[key] || 0) + 1;
  }

  return {
    data: {
      summary: {
        totalTransitions: rows.length,
        uniqueIndexes: new Set(rows.map((r: any) => r.metadata?.index_name).filter(Boolean)).size,
        transitionFrequency: transitionCounts,
      },
      events: rows.map((r: any) => ({
        id: r.event_id,
        correlationId: r.correlation_id,
        indexName: r.metadata?.index_name || null,
        sourcetype: r.metadata?.sourcetype || null,
        fromState: r.previous_state || null,
        toState: r.lifecycle_state,
        transitionReason: r.state_transition_reason,
        actorId: r.metadata?.actor_id || null,
        actorEmail: r.metadata?.actor_email || null,
        sessionId: r.metadata?.session_id || null,
        traceId: r.trace_id,
        durationMs: r.duration_in_state_ms,
        status: r.status,
        executionContext: r.execution_context,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        enteredAt: r.entered_at,
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
       (correlation_id, lifecycle_state, previous_state, state_transition_reason, entered_at, duration_in_state_ms, recorded_at, trace_id, status, execution_context, metadata)
     VALUES ($1,$2,$3,$4,NOW(),$5,NOW(),$6,'success','PRODUCTION',$7::jsonb)`,
    [
      body.correlationId || `${indexName}-${Date.now()}`,
      toState,
      fromState || null,
      transitionReason || null,
      durationMs || null,
      traceId || null,
      JSON.stringify({
        index_name: indexName,
        sourcetype: sourcetype || null,
        actor_email: actorEmail || null,
        session_id: sessionId || null,
      }),
    ]
  );

  return {
    data: { ok: true },
    meta: { source: 'postgres' },
  };
});
