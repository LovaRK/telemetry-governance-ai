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

  // One row per calendar date — pick the snapshot with the most sourcetypes
  // (i.e. the real production snapshot, not demo/placeholder rows).
  // Deduplication prevents old demo data from flattening the trend line.
  const result = await query(
    `WITH ranked AS (
      SELECT
        DATE(COALESCE(pr.published_at, ek.created_at)) AS date,
        ek.roi_score::float8                 AS "roiScore",
        ek.gainscope_score::float8           AS "gainScopeScore",
        ek.storage_savings_potential::float8 AS "storageSavingsPotential",
        ek.total_daily_gb::float8            AS "totalDailyGb",
        ek.avg_utilization::float8           AS "avgUtilization",
        ek.avg_detection::float8             AS "avgDetection",
        ek.avg_quality::float8               AS "avgQuality",
        ek.avg_confidence::float8            AS "avgConfidence",
        ek.total_sourcetypes                 AS total_sourcetypes,
        ROW_NUMBER() OVER (
          PARTITION BY DATE(COALESCE(pr.published_at, ek.created_at))
          ORDER BY ek.total_sourcetypes DESC, ek.created_at DESC
        ) AS rn
      FROM executive_kpis ek
      LEFT JOIN pipeline_runs pr
        ON pr.snapshot_id = ek.snapshot_id
        AND pr.tenant_id::uuid = ek.tenant_id
      WHERE ek.tenant_id = $1
        AND COALESCE(pr.published_at, ek.created_at) >= NOW() - ($2 || ' days')::interval
        AND ek.total_sourcetypes > 0
    )
    SELECT
      date,
      "roiScore",
      CASE WHEN "roiScore" IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "roiScoreClassification",
      "gainScopeScore",
      CASE WHEN "gainScopeScore" IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "gainScopeScopeClassification",
      "storageSavingsPotential",
      CASE WHEN "storageSavingsPotential" IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "storageSavingsPotentialClassification",
      "totalDailyGb",
      "avgUtilization",
      CASE WHEN "avgUtilization" IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "avgUtilizationClassification",
      "avgDetection",
      CASE WHEN "avgDetection" IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "avgDetectionClassification",
      "avgQuality",
      CASE WHEN "avgQuality" IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "avgQualityClassification",
      "avgConfidence",
      CASE WHEN "avgConfidence" IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "avgConfidenceClassification"
    FROM ranked
    WHERE rn = 1
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
