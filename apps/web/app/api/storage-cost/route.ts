import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import { getLatestPublishedRun } from '@/lib/pipeline-ledger-service';
import {
  computeDeterministicSavings,
  type RetentionInput,
  type CompressionSavingsInput,
} from '@packages/core/engine/savings/storage';

/**
 * GET /api/storage-cost
 *
 * High Storage Cost Assessment — per-index storage cost ranking with
 * retention/compression savings breakdown (guide §8, 3rd dashboard).
 */
export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const { tenantId } = ctxOrError;

  const publishedRun = await getLatestPublishedRun(tenantId);
  if (!publishedRun) {
    return { data: { empty: true, rows: [] }, meta: { source: 'storage-cost' } };
  }

  const result = await query(
    `SELECT
       ad.index_name,
       ad.sourcetype,
       ad.tier,
       ad.action,
       ad.utilization_score,
       COALESCE(ts.daily_avg_gb, 0)::float AS daily_avg_gb,
       COALESCE(ts.retention_days, 90)::int AS retention_days,
       COALESCE(ts.cost_per_year, 0)::float AS cost_per_year
     FROM agent_decisions ad
     JOIN telemetry_snapshots ts
       ON ts.tenant_id = ad.tenant_id
      AND ts.snapshot_id = ad.snapshot_id
      AND ts.index_name = ad.index_name
      AND ts.sourcetype IS NOT DISTINCT FROM ad.sourcetype
     WHERE ad.tenant_id = $1
       AND ad.snapshot_id = $2
     ORDER BY ts.cost_per_year DESC`,
    [tenantId, publishedRun.snapshotId]
  );

  const rows = (result.rows || []).map((r: any) => {
    const dagb = parseFloat(r.daily_avg_gb) || 0;
    const retIn: RetentionInput = { dailyAvgGb: dagb, retentionDays: parseInt(r.retention_days) || 90 };
    const compIn: CompressionSavingsInput = { dailyAvgGb: dagb, utilizationPct: parseFloat(r.utilization_score) || 0 };
    const savings = computeDeterministicSavings(retIn, null, compIn);

    return {
      indexName: r.index_name,
      sourcetype: r.sourcetype,
      tier: r.tier,
      action: r.action,
      dailyAvgGb: dagb,
      retentionDays: parseInt(r.retention_days) || 90,
      annualCost: Math.round((parseFloat(r.cost_per_year) || 0) * 100) / 100,
      utilizationScore: parseFloat(r.utilization_score) || 0,
      retentionSavings: savings.retentionSavings,
      fieldSavings: savings.fieldSavings,
      compressionSavings: savings.compressionSavings,
      totalSavings: savings.totalSavings,
      confidence: savings.confidence,
    };
  });

  const totalAnnualCost = rows.reduce((s: number, r: any) => s + r.annualCost, 0);
  const totalSavings = rows.reduce((s: number, r: any) => s + r.totalSavings, 0);

  return {
    data: {
      empty: false,
      rows,
      summary: {
        totalAnnualCost: Math.round(totalAnnualCost * 100) / 100,
        totalSavings: Math.round(totalSavings * 100) / 100,
        indexCount: rows.length,
      },
    },
    meta: { source: 'storage-cost', snapshotId: publishedRun.snapshotId },
  };
});
