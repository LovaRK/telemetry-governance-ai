import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { governanceCausalityService } from '@/services/governance-causality-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * POST /api/governance/cache-coherence
 *
 * Record cache coherence telemetry for a mutation
 * Measures UI/server synchronization latency and divergence windows
 *
 * Request body:
 * {
 *   "indexName": "my_index",
 *   "correlationId": "corr_...",
 *   "mutationCommittedAt": "2026-05-18T...",
 *   "invalidationRequestedAt": "2026-05-18T...",
 *   "serverResponseReceivedAt": "2026-05-18T...",
 *   "uiRefetchInitiatedAt": "2026-05-18T...",
 *   "uiAcknowledgedAt": "2026-05-18T...",
 *   "invalidationFailed": false,
 *   "refetchFailed": false,
 *   "uiStillStale": false
 * }
 *
 * Response:
 * {
 *   "coherenceId": "coh_...",
 *   "totalDivergenceWindowMs": 450,
 *   "isDivergent": false,
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

    // Calculate coherence metrics
    const metrics = governanceCausalityService.calculateCacheCoherenceMetrics(
      body.indexName,
      body.correlationId,
      {
        mutationCommittedAt: new Date(body.mutationCommittedAt),
        invalidationRequestedAt: body.invalidationRequestedAt ? new Date(body.invalidationRequestedAt) : undefined,
        serverResponseReceivedAt: body.serverResponseReceivedAt ? new Date(body.serverResponseReceivedAt) : undefined,
        uiRefetchInitiatedAt: body.uiRefetchInitiatedAt ? new Date(body.uiRefetchInitiatedAt) : undefined,
        uiAcknowledgedAt: body.uiAcknowledgedAt ? new Date(body.uiAcknowledgedAt) : undefined,
      },
      {
        invalidationFailed: body.invalidationFailed,
        refetchFailed: body.refetchFailed,
        uiStillStale: body.uiStillStale,
      }
    );

    // Record to cache_coherence_telemetry
    const client = await pool.connect();
    try {
      await client.query(
        `
        INSERT INTO cache_coherence_telemetry (
          coherence_id,
          index_name,
          mutation_committed_at,
          invalidation_requested_at,
          server_response_received_at,
          ui_refetch_initiated_at,
          ui_acknowledged_at,
          server_commit_to_invalidation_ms,
          invalidation_to_client_awareness_ms,
          client_awareness_to_refetch_ms,
          refetch_to_ui_reconciliation_ms,
          total_divergence_window_ms,
          is_divergent,
          invalidation_failed,
          refetch_failed,
          ui_still_stale,
          correlation_id,
          recorded_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW()
        )
        `,
        [
          metrics.coherenceId,
          metrics.indexName,
          metrics.mutationCommittedAt,
          metrics.invalidationRequestedAt || null,
          metrics.serverResponseReceivedAt || null,
          metrics.uiRefetchInitiatedAt || null,
          metrics.uiAcknowledgedAt || null,
          metrics.serverCommitToInvalidationMs || null,
          metrics.invalidationToClientAwarenessMs || null,
          metrics.clientAwarenessToRefetchMs || null,
          metrics.refetchToUiReconciliationMs || null,
          metrics.totalDivergenceWindowMs || null,
          metrics.isDivergent || false,
          metrics.invalidationFailed || false,
          metrics.refetchFailed || false,
          metrics.uiStillStale || false,
          metrics.correlationId,
        ]
      );
    } finally {
      client.release();
    }

    return NextResponse.json(
      {
        coherenceId: metrics.coherenceId,
        totalDivergenceWindowMs: metrics.totalDivergenceWindowMs,
        isDivergent: metrics.isDivergent,
        recorded: true,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error recording cache coherence metrics:', error);
    return NextResponse.json(
      { error: 'Failed to record cache coherence metrics' },
      { status: 500 }
    );
  }
}
