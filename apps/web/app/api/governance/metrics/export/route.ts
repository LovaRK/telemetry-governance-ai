import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import { NextResponse } from 'next/server';

/**
 * GET /api/governance/metrics/export
 * LLM execution metrics: latency, fallback rate, provider health.
 */
export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;
  const days = Math.min(parseInt(new URL(request.url).searchParams.get('days') || '30', 10), 365);

  const summaryResult = await query<any>(
    `SELECT provider, explanation_type,
       COUNT(*)::int AS call_count,
       COUNT(*) FILTER (WHERE fallback_used)::int AS fallback_count,
       ROUND(COUNT(*) FILTER (WHERE fallback_used)*100.0/COUNT(*),1)::float AS fallback_pct,
       ROUND(AVG(latency_ms))::int AS avg_latency_ms,
       ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_latency_ms,
       MAX(latency_ms)::int AS max_latency_ms,
       COUNT(*) FILTER (WHERE NOT success)::int AS error_count
     FROM llm_execution_metrics
     WHERE tenant_id::text = $1 AND created_at >= NOW() - ($2||' days')::INTERVAL
     GROUP BY provider, explanation_type ORDER BY call_count DESC`,
    [tenantId, days]
  );
  const recentResult = await query<any>(
    `SELECT explanation_type, sourcetype, provider, latency_ms, fallback_used, success, created_at
     FROM llm_execution_metrics WHERE tenant_id::text = $1 ORDER BY created_at DESC LIMIT 20`,
    [tenantId]
  );
  const totalCalls = summaryResult.rows.reduce((s: number, r: any) => s + r.call_count, 0);
  const totalFallbacks = summaryResult.rows.reduce((s: number, r: any) => s + r.fallback_count, 0);
  return {
    data: {
      period_days: days,
      overview: { total_calls: totalCalls, total_fallbacks: totalFallbacks,
        fallback_pct: totalCalls > 0 ? Math.round(totalFallbacks/totalCalls*100) : 0,
        llm_available: totalFallbacks < totalCalls },
      by_provider_and_type: summaryResult.rows,
      recent_calls: recentResult.rows,
    },
    meta: { tenantId },
  };
});
