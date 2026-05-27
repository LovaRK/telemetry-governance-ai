import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';

export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;

  const tenantId = ctxOrError.tenantId;
  const daysParam = Number(request.nextUrl.searchParams.get('days') || '7');
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;

  const result = await query(
    `SELECT
      DATE(COALESCE(pr.published_at, ek.created_at)) AS date,
      COALESCE(ek.roi_score, 0)::float8 AS "roiScore",
      COALESCE(ek.gainscope_score, 0)::float8 AS "gainScopeScore",
      COALESCE(ek.storage_savings_potential, 0)::float8 AS "storageSavingsPotential",
      COALESCE(ek.total_daily_gb, 0)::float8 AS "totalDailyGb",
      COALESCE(ek.avg_utilization, 0)::float8 AS "avgUtilization",
      COALESCE(ek.avg_detection, 0)::float8 AS "avgDetection",
      COALESCE(ek.avg_quality, 0)::float8 AS "avgQuality",
      LEAST(100, GREATEST(0, COALESCE(ek.avg_confidence, 0)::float8)) AS "avgConfidence"
    FROM executive_kpis ek
    LEFT JOIN pipeline_runs pr
      ON pr.snapshot_id = ek.snapshot_id
      AND pr.tenant_id::uuid = ek.tenant_id
    WHERE ek.tenant_id = $1
      AND COALESCE(pr.published_at, ek.created_at) >= NOW() - ($2 || ' days')::interval
    ORDER BY date ASC`,
    [tenantId, String(days)],
    ctxOrError
  );

  return {
    data: {
      mode: 'LIVE',
      data: result.rows,
      days,
      points: result.rows.length,
      insufficientHistory: result.rows.length < 2,
    },
    meta: {
      source: 'postgres',
      tenantId,
    },
  };
});
