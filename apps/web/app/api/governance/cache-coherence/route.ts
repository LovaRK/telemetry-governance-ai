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
    `SELECT id, index_name, cache_tier, coherence_score, staleness_seconds,
            hit_rate, miss_rate, eviction_count, drift_detected, drift_severity,
            last_validated_at, recorded_at
     FROM cache_coherence_telemetry
     ${where}
     ORDER BY recorded_at DESC LIMIT $1`,
    params
  );

  const rows = res.rows || [];
  const avgCoherence = rows.length > 0
    ? rows.reduce((s: number, r: any) => s + parseFloat(r.coherence_score || '0'), 0) / rows.length : 0;

  return {
    data: {
      summary: {
        avgCoherenceScore: Math.round(avgCoherence * 100) / 100,
        driftDetectedCount: rows.filter((r: any) => r.drift_detected).length,
        avgHitRatePct: rows.length > 0
          ? Math.round(rows.reduce((s: number, r: any) => s + parseFloat(r.hit_rate || '0'), 0) / rows.length * 10000) / 100
          : 0,
        totalRecords: rows.length,
      },
      records: rows.map((r: any) => ({
        id: r.id,
        indexName: r.index_name,
        cacheTier: r.cache_tier,
        coherenceScore: parseFloat(r.coherence_score || '0'),
        stalenessSeconds: parseFloat(r.staleness_seconds || '0'),
        hitRate: parseFloat(r.hit_rate || '0'),
        missRate: parseFloat(r.miss_rate || '0'),
        evictionCount: parseInt(r.eviction_count || '0', 10),
        driftDetected: Boolean(r.drift_detected),
        driftSeverity: r.drift_severity || null,
        lastValidatedAt: r.last_validated_at,
        recordedAt: r.recorded_at,
      })),
      lastUpdate: new Date().toISOString(),
    },
    meta: { source: 'postgres' },
  };
});

/** POST — record a new coherence observation (called by the aggregation worker) */
export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const { indexName, cacheTier, coherenceScore, stalenessSeconds, hitRate, missRate, driftDetected, driftSeverity } = body;

  await query(
    `INSERT INTO cache_coherence_telemetry
       (index_name, cache_tier, coherence_score, staleness_seconds, hit_rate, miss_rate, drift_detected, drift_severity, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [indexName, cacheTier || 'HOT', coherenceScore ?? 100, stalenessSeconds ?? 0, hitRate ?? 1, missRate ?? 0, driftDetected ?? false, driftSeverity || null]
  );

  return {
    data: { ok: true },
    meta: { source: 'postgres' },
  };
});
