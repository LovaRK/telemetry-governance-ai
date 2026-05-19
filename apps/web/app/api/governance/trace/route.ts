import { NextRequest, NextResponse } from 'next/server';
import { query } from '@core/database/connection';

/**
 * GET /api/governance/trace
 *
 * Returns decision trace records — the full causal chain from Splunk telemetry
 * through aggregation → LLM → governance decision, linked by trace_id.
 *
 * Query params:
 *   traceId    (optional, look up one specific trace)
 *   index      (optional, all traces for one index)
 *   limit      (default 50)
 *   since      (ISO date, optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const traceId = searchParams.get('traceId');
    const index   = searchParams.get('index');
    const limit   = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
    const since   = searchParams.get('since');

    const conditions: string[] = [];
    const params: any[] = [];

    if (traceId) { params.push(traceId); conditions.push(`trace_id = $${params.length}`); }
    if (index)   { params.push(index);   conditions.push(`index_name = $${params.length}`); }
    if (since)   { params.push(since);   conditions.push(`recorded_at >= $${params.length}`); }

    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await query<any>(
      `SELECT id, trace_id, span_id, parent_span_id, index_name, sourcetype,
              stage, stage_status, latency_ms, payload_summary, error_message,
              actor_email, recorded_at
       FROM decision_traces
       ${where}
       ORDER BY recorded_at DESC LIMIT $${params.length}`,
      params
    );

    const rows = res.rows || [];

    // Group spans into traces
    const traceMap: Record<string, any[]> = {};
    for (const r of rows) {
      if (!traceMap[r.trace_id]) traceMap[r.trace_id] = [];
      traceMap[r.trace_id].push(r);
    }

    const traces = Object.entries(traceMap).map(([tid, spans]) => {
      const sorted = spans.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
      const totalLatency = spans.reduce((s, sp) => s + (parseInt(sp.latency_ms) || 0), 0);
      const hasError = spans.some(sp => sp.stage_status === 'ERROR');
      return {
        traceId: tid,
        indexName: sorted[0]?.index_name,
        sourcetype: sorted[0]?.sourcetype,
        spanCount: spans.length,
        totalLatencyMs: totalLatency,
        status: hasError ? 'ERROR' : 'OK',
        startedAt: sorted[0]?.recorded_at,
        completedAt: sorted[sorted.length - 1]?.recorded_at,
        spans: sorted.map((sp: any) => ({
          spanId: sp.span_id,
          parentSpanId: sp.parent_span_id,
          stage: sp.stage,
          status: sp.stage_status,
          latencyMs: parseInt(sp.latency_ms) || 0,
          payloadSummary: sp.payload_summary,
          errorMessage: sp.error_message,
          actorEmail: sp.actor_email,
          recordedAt: sp.recorded_at,
        })),
      };
    });

    return NextResponse.json({
      summary: {
        totalTraces: traces.length,
        errorTraces: traces.filter(t => t.status === 'ERROR').length,
        avgLatencyMs: traces.length > 0
          ? Math.round(traces.reduce((s, t) => s + t.totalLatencyMs, 0) / traces.length)
          : 0,
      },
      traces,
      lastUpdate: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[trace]', e);
    return NextResponse.json({ error: 'Failed to fetch trace data', traces: [] }, { status: 500 });
  }
}

/** POST — record a new trace span */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { traceId, spanId, parentSpanId, indexName, sourcetype, stage, stageStatus, latencyMs, payloadSummary, errorMessage, actorEmail } = body;

    if (!traceId || !stage) {
      return NextResponse.json({ error: 'traceId and stage are required' }, { status: 400 });
    }

    await query(
      `INSERT INTO decision_traces
         (trace_id, span_id, parent_span_id, index_name, sourcetype, stage, stage_status, latency_ms, payload_summary, error_message, actor_email, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [traceId, spanId || null, parentSpanId || null, indexName || null, sourcetype || null, stage, stageStatus || 'OK', latencyMs || 0, payloadSummary || null, errorMessage || null, actorEmail || null]
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[trace POST]', e);
    return NextResponse.json({ error: 'Failed to record trace span' }, { status: 500 });
  }
}
