import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { governanceCausalityService } from '@/services/governance-causality-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * POST /api/governance/trace
 *
 * Register a correlation context at mutation origin
 * Used by client to establish causal lineage for distributed trace
 *
 * Request body:
 * {
 *   "indexName": "my_index",
 *   "sessionId": "sess_...",
 *   "parentCorrelationId": "corr_..."  // optional, for chained mutations
 * }
 *
 * Response:
 * {
 *   "correlationId": "corr_1234567890_abc123...",
 *   "traceId": "trace_...",
 *   "spanId": "span_...",
 *   "sessionId": "sess_...",
 *   "recorded": true
 * }
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { indexName, sessionId, parentCorrelationId } = body;

    // Generate correlation context
    const correlationContext = governanceCausalityService.generateCorrelationContext(sessionId);

    // If this is a chained mutation, extend the context with parent reference
    let contextToStore = correlationContext;
    if (parentCorrelationId) {
      contextToStore = governanceCausalityService.extendCorrelationContext(
        correlationContext,
        parentCorrelationId
      );
    }

    // Record to governance_mutation_journal with trace context
    const client = await pool.connect();
    try {
      await client.query(
        `
        UPDATE governance_mutation_journal
        SET
          correlation_id = $1,
          causal_parent_id = $2,
          trace_id = $3,
          span_id = $4,
          parent_span_id = $5,
          session_id = $6
        WHERE index_name = $7 AND recorded_at > NOW() - INTERVAL '1 second'
        ORDER BY recorded_at DESC LIMIT 1
        `,
        [
          contextToStore.correlationId,
          contextToStore.causalParentId || null,
          contextToStore.traceId,
          contextToStore.spanId,
          contextToStore.parentSpanId || null,
          contextToStore.sessionId || null,
          indexName,
        ]
      );
    } finally {
      client.release();
    }

    return NextResponse.json(
      {
        ...contextToStore,
        recorded: true,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error registering correlation context:', error);
    return NextResponse.json(
      { error: 'Failed to register correlation context' },
      { status: 500 }
    );
  }
}
