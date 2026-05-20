/**
 * SSE Streaming Endpoint: Real-Time Control Plane Event Feed
 *
 * Implements event-native transport: filters database ledger events by taxonomy/severity,
 * streams them in monotonic sequence order, and gracefully handles client disconnection.
 *
 * Query Parameters:
 * - execution_id: Filter events for specific execution (required for targeted stream)
 * - taxonomy: Comma-separated list (POLICY,GOVERNANCE,AGENT)
 * - severity: Comma-separated list (CRITICAL,HIGH,WARN,INFO)
 *
 * Response Format: Server-Sent Events (text/event-stream)
 *
 * L3 Compliance: Uses createStreamRoute for trace context injection via AsyncLocalStorage.
 * SSE events include source, mode, and traceId for observability.
 */

import { NextRequest } from 'next/server';
import { createStreamRoute } from '@/lib/stream-route-factory';
import { getExecutionTimeline, getRecentEventsByTaxonomy } from '@core/database/pipeline-events';
import { getTraceId } from '@core/guards/trace-context';

export const dynamic = 'force-dynamic';

export const GET = createStreamRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const executionId = searchParams.get('execution_id');
  const taxonomyFilter = searchParams.get('taxonomy')?.split(',') || [];
  const severityFilter = searchParams.get('severity')?.split(',') || [];

  // Establish SSE transport
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();
  let lastSeenSequence = 0;

  // If execution_id provided, bootstrap with full historical timeline first
  if (executionId) {
    try {
      const historicalTimeline = await getExecutionTimeline(executionId);

      for (const event of historicalTimeline) {
        // Apply dynamic filters
        if (taxonomyFilter.length > 0 && !taxonomyFilter.includes(event.taxonomy)) continue;
        if (severityFilter.length > 0 && !severityFilter.includes(event.severity)) continue;

        lastSeenSequence = event.sequence;

        const sseFormattedFrame = `event: CONTROL_PLANE_UPDATE\ndata: ${JSON.stringify({
          ...event,
          source: 'system',
          mode: 'live',
          replayed: true,
          traceId: getTraceId(),
        })}\n\n`;
        await writer.write(encoder.encode(sseFormattedFrame));
      }
    } catch (err) {
      console.error('[SSE] Historical bootstrap failed:', err);
    }
  }

  // Real-time polling loop: tail database for new events
  const pollIntervalId = setInterval(async () => {
    try {
      if (!executionId) {
        // Keep-alive ping for global stream subscribers
        const pingPayload = { type: 'PING', timestamp: new Date().toISOString() };
        await writer.write(encoder.encode(`event: KEEP_ALIVE\ndata: ${JSON.stringify(pingPayload)}\n\n`));
        return;
      }

      // Tail recent events (only fetch what's new since last sequence)
      const recentEvents = await getRecentEventsByTaxonomy('POLICY', 100);
      const targetEvents = recentEvents
        .filter(evt => evt.execution_id === executionId && evt.sequence > lastSeenSequence)
        .sort((a, b) => a.sequence - b.sequence);

      for (const event of targetEvents) {
        // Apply dynamic filters
        if (taxonomyFilter.length > 0 && !taxonomyFilter.includes(event.taxonomy)) continue;
        if (severityFilter.length > 0 && !severityFilter.includes(event.severity)) continue;

        lastSeenSequence = event.sequence;

        const sseFormattedFrame = `event: CONTROL_PLANE_UPDATE\ndata: ${JSON.stringify({
          ...event,
          source: 'system',
          mode: 'live',
          traceId: getTraceId(),
        })}\n\n`;
        await writer.write(encoder.encode(sseFormattedFrame));
      }
    } catch (err) {
      console.error('[SSE] Real-time poll failed:', err);
      // Don't close stream on transient error; client will reconnect
    }
  }, 1000); // Poll every 1 second for new events

  // Graceful shutdown on client disconnect
  request.signal.addEventListener('abort', () => {
    clearInterval(pollIntervalId);
    writer.close();
    console.log('[SSE] Client disconnected, stream closed');
  });

  return new Response(responseStream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
