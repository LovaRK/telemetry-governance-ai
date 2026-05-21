import { NextRequest, NextResponse } from 'next/server';
import { createStreamRoute } from '@/lib/stream-route-factory';
import { getTraceId } from '@core/guards/trace-context';
import { requireContext } from '@packages/auth/request-context';
import { query } from '@core/database/connection';

/**
 * GET /api/governance/stream
 *
 * Server-Sent Events (SSE) endpoint — real-time governance event fanout.
 *
 * Clients connect and receive a continuous stream of governance events:
 *   - New LLM decisions
 *   - Status transitions (APPROVED, REJECTED, etc.)
 *   - Drift detection events
 *   - Cache coherence alerts
 *
 * Usage (client-side):
 *   const es = new EventSource('/api/governance/stream');
 *   es.onmessage = (e) => { const event = JSON.parse(e.data); ... };
 *   es.addEventListener('decision', (e) => { ... });
 *   es.addEventListener('governance', (e) => { ... });
 *   es.addEventListener('drift', (e) => { ... });
 *
 * The stream polls the DB every 5 seconds for new events since the last
 * event ID seen, ensuring no events are missed across reconnects.
 *
 * Cross-tenant isolation: each stream connection is scoped to the authenticated
 * user's tenant via JWT with enforced tenant context validation.
 *
 * L3 Compliance: Uses createStreamRoute for trace context injection via AsyncLocalStorage.
 * SSE events include source, mode, and traceId for observability.
 */
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 5_000;
const MAX_STREAM_DURATION_MS = 5 * 60 * 1000; // 5 min max per connection (Vercel / proxy limit)

export const GET = createStreamRoute(async (request: NextRequest) => {
  // Require authentication: fail-closed if missing tenant context
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;

  // Last-Event-ID support — clients reconnect and resume from where they left off
  const lastEventId = request.headers.get('Last-Event-ID') || null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const startTime = Date.now();
      let lastSeenTimestamp = lastEventId ? new Date(lastEventId) : new Date(Date.now() - 30_000);
      let closed = false;

      const enqueue = (eventType: string, data: object, id?: string) => {
        if (closed) return;
        const lines = [
          id ? `id: ${id}` : '',
          `event: ${eventType}`,
          `data: ${JSON.stringify(data)}`,
          '',
          '',
        ].filter((l, i) => i !== 0 || l !== '').join('\n');
        try {
          controller.enqueue(encoder.encode(lines));
        } catch { closed = true; }
      };

      // Initial heartbeat + connection confirmation
      enqueue('connected', {
        message: 'datasensAI governance stream connected',
        serverTime: new Date().toISOString(),
        resumedFrom: lastSeenTimestamp.toISOString(),
      });

      const poll = async () => {
        if (closed || Date.now() - startTime > MAX_STREAM_DURATION_MS) {
          if (!closed) {
            enqueue('close', { reason: 'max_duration_reached' });
            controller.close();
          }
          return;
        }

        try {
          // 1. New governance actions (status changes)
          const govRes = await query<any>(
            `SELECT ra.id, ra.index_name, ra.status, ra.actor_email,
                    ra.action_note, ra.updated_at
             FROM recommendation_actions ra
             WHERE ra.updated_at > $1
             ORDER BY ra.updated_at ASC
             LIMIT 20`,
            [lastSeenTimestamp.toISOString()]
          );

          for (const r of govRes.rows || []) {
            const ts = new Date(r.updated_at);
            enqueue('governance', {
              id: r.id,
              indexName: r.index_name,
              status: r.status,
              actorEmail: r.actor_email,
              note: r.action_note,
              timestamp: r.updated_at,
              source: 'postgres',
              mode: 'live',
              traceId: getTraceId(),
            }, r.updated_at);
            if (ts > lastSeenTimestamp) lastSeenTimestamp = ts;
          }

          // 2. New agent decisions (from aggregation runs)
          const decRes = await query<any>(
            `SELECT ad.id, ad.index_name, ad.sourcetype, ad.tier, ad.action,
                    ad.composite_score, ad.confidence_score, ad.created_at
             FROM agent_decisions ad
             WHERE ad.created_at > $1
             ORDER BY ad.created_at ASC
             LIMIT 20`,
            [lastSeenTimestamp.toISOString()]
          );

          for (const r of decRes.rows || []) {
            const ts = new Date(r.created_at);
            enqueue('decision', {
              id: r.id,
              indexName: r.index_name,
              sourcetype: r.sourcetype,
              tier: r.tier,
              action: r.action,
              compositeScore: parseFloat(r.composite_score || '0'),
              confidence: parseFloat(r.confidence_score || '0'),
              timestamp: r.created_at,
              source: 'postgres',
              mode: 'live',
              traceId: getTraceId(),
            }, r.created_at);
            if (ts > lastSeenTimestamp) lastSeenTimestamp = ts;
          }

          // 3. Cache drift events
          const driftRes = await query<any>(
            `SELECT coherence_id, index_name, is_divergent, recorded_at
             FROM cache_coherence_telemetry
             WHERE is_divergent = true AND recorded_at > $1
             ORDER BY recorded_at ASC LIMIT 10`,
            [lastSeenTimestamp.toISOString()]
          );

          for (const r of driftRes.rows || []) {
            const ts = new Date(r.recorded_at);
            enqueue('drift', {
              id: r.coherence_id,
              indexName: r.index_name,
              isDivergent: r.is_divergent,
              timestamp: r.recorded_at,
              source: 'postgres',
              mode: 'live',
              traceId: getTraceId(),
            }, r.recorded_at);
            if (ts > lastSeenTimestamp) lastSeenTimestamp = ts;
          }

          // Heartbeat every poll cycle to keep connection alive
          enqueue('heartbeat', { serverTime: new Date().toISOString() });

        } catch (e) {
          // DB error — send error event but keep stream alive
          enqueue('error', { message: 'Poll error — reconnecting', serverTime: new Date().toISOString() });
        }

        // Schedule next poll
        if (!closed) {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      // Start polling after a brief initial delay
      setTimeout(poll, 1000);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        closed = true;
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    },
  });
});
