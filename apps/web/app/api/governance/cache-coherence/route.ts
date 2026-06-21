import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

/**
 * GET /api/governance/cache-coherence
 *
 * Returns cache coherence telemetry — per-index staleness, hit rates, drift events.
 * Used by the DriftMonitor / cache health components.
 */
export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
  const indexFilter = searchParams.get('index');

  const params: any[] = [limit];
  const where = indexFilter ? `WHERE index_name = $2` : '';
  if (indexFilter) params.push(indexFilter);

  const res = await query<any>(
    `SELECT coherence_id, index_name, correlation_id,
            total_divergence_window_ms, is_divergent,
            invalidation_failed, refetch_failed, ui_still_stale,
            server_commit_to_invalidation_ms, invalidation_to_client_awareness_ms,
            client_awareness_to_refetch_ms, refetch_to_ui_reconciliation_ms,
            mutation_committed_at, ui_acknowledged_at, recorded_at
     FROM cache_coherence_telemetry
     ${where}
     ORDER BY recorded_at DESC LIMIT $1`,
    params
  );

  const rows = res.rows || [];
  const normalized = rows.map((r: any) => {
    const divergenceMs = parseInt(r.total_divergence_window_ms || '0', 10);
    const coherenceScore = r.is_divergent ? 0 : 1;
    const stalenessSeconds = Math.max(0, divergenceMs / 1000);
    const driftSeverity = divergenceMs >= 300000
      ? 'CRITICAL'
      : divergenceMs >= 120000
        ? 'HIGH'
        : divergenceMs >= 30000
          ? 'MEDIUM'
          : r.is_divergent
            ? 'LOW'
            : null;
    const missRate = r.refetch_failed ? 1 : 0;
    const hitRate = 1 - missRate;

    return {
      id: r.coherence_id,
      indexName: r.index_name,
      correlationId: r.correlation_id,
      coherenceScore,
      stalenessSeconds,
      hitRate,
      missRate,
      evictionCount: 0,
      driftDetected: Boolean(r.is_divergent),
      driftSeverity,
      invalidationFailed: Boolean(r.invalidation_failed),
      refetchFailed: Boolean(r.refetch_failed),
      uiStillStale: Boolean(r.ui_still_stale),
      serverCommitToInvalidationMs: parseInt(r.server_commit_to_invalidation_ms || '0', 10),
      invalidationToClientAwarenessMs: parseInt(r.invalidation_to_client_awareness_ms || '0', 10),
      clientAwarenessToRefetchMs: parseInt(r.client_awareness_to_refetch_ms || '0', 10),
      refetchToUiReconciliationMs: parseInt(r.refetch_to_ui_reconciliation_ms || '0', 10),
      mutationCommittedAt: r.mutation_committed_at,
      lastValidatedAt: r.ui_acknowledged_at || r.recorded_at,
      recordedAt: r.recorded_at,
    };
  });

  const avgCoherence = normalized.length > 0
    ? normalized.reduce((s: number, r: any) => s + r.coherenceScore, 0) / normalized.length : 0;

  return {
    data: {
      summary: {
        avgCoherenceScore: Math.round(avgCoherence * 100) / 100,
        driftDetectedCount: normalized.filter((r: any) => r.driftDetected).length,
        avgHitRatePct: normalized.length > 0
          ? Math.round(normalized.reduce((s: number, r: any) => s + r.hitRate, 0) / normalized.length * 10000) / 100
          : 0,
        totalRecords: normalized.length,
      },
      records: normalized,
      lastUpdate: new Date().toISOString(),
    },
    meta: { source: 'postgres' },
  };
});

/** POST — record a new coherence observation (called by the aggregation worker) */
export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const {
    indexName,
    correlationId,
    mutationCommittedAt,
    serverCommitToInvalidationMs,
    invalidationToClientAwarenessMs,
    clientAwarenessToRefetchMs,
    refetchToUiReconciliationMs,
    totalDivergenceWindowMs,
    isDivergent,
    invalidationFailed,
    refetchFailed,
    uiStillStale,
  } = body;

  await query(
    `INSERT INTO cache_coherence_telemetry
       (index_name, correlation_id, mutation_committed_at,
        server_commit_to_invalidation_ms, invalidation_to_client_awareness_ms,
        client_awareness_to_refetch_ms, refetch_to_ui_reconciliation_ms,
        total_divergence_window_ms, is_divergent,
        invalidation_failed, refetch_failed, ui_still_stale,
        recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
    [
      indexName,
      correlationId || crypto.randomUUID(),
      mutationCommittedAt || new Date().toISOString(),
      serverCommitToInvalidationMs ?? 0,
      invalidationToClientAwarenessMs ?? 0,
      clientAwarenessToRefetchMs ?? 0,
      refetchToUiReconciliationMs ?? 0,
      totalDivergenceWindowMs ?? 0,
      isDivergent ?? false,
      invalidationFailed ?? false,
      refetchFailed ?? false,
      uiStillStale ?? false,
    ]
  );

  return {
    data: { ok: true },
    meta: { source: 'postgres' },
  };
});
