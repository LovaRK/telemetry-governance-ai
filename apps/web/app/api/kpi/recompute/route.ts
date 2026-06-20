import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import { getLatestPublishedRun } from '@/lib/pipeline-ledger-service';
import {
  computeCompositeScore,
  assignTier,
  computeROIScore,
  computeGainScope,
  computeLowValueSpend,
  validateWeights,
  DEFAULT_WEIGHTS,
  type ScoringWeights,
  type ScoredSourcetype,
  type TierLabel,
} from '@api/services/deterministic-scoring-engine';
import { computeDeterministicSavings, type RetentionInput, type CompressionSavingsInput, type SavingsConfig } from '@packages/core/engine/savings/storage';

/**
 * POST /api/kpi/recompute
 *
 * Live "what-if" recomputation for the dashboard filter bar. Given new weights
 * and/or a new cost-per-GB-year, recomputes composite/tier per sourcetype and
 * all portfolio KPIs from the ALREADY-PERSISTED raw U/D/Q sub-scores — no
 * Splunk call, no LLM, no pipeline run, no DB writes.
 *
 * The math is the SAME engine the pipeline uses (imported, not copied), so
 * what-if numbers and persisted numbers are guaranteed consistent.
 *
 * Body: { weights?: {utilization,detection,quality}, costPerGbYear?: number }
 */
export const POST = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const { tenantId } = ctxOrError;

  const body = await request.json().catch(() => ({}));

  // Resolve weights (default to balanced); reject if they don't sum to 1.0
  const weights: ScoringWeights = {
    utilization: Number(body?.weights?.utilization ?? DEFAULT_WEIGHTS.utilization),
    detection: Number(body?.weights?.detection ?? DEFAULT_WEIGHTS.detection),
    quality: Number(body?.weights?.quality ?? DEFAULT_WEIGHTS.quality),
  };
  try {
    validateWeights(weights);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, meta: { source: 'recompute', mode: 'live', traceId: 'unknown' } },
      { status: 400 }
    );
  }

  const costPerGbYear = Number.isFinite(Number(body?.costPerGbYear))
    ? Number(body.costPerGbYear)
    : null;
  const storageCostPerGbMonth = Number.isFinite(Number(body?.storageCostPerGbMonth))
    ? Number(body.storageCostPerGbMonth)
    : null;

  const publishedRun = await getLatestPublishedRun(tenantId);
  if (!publishedRun) {
    return {
      data: { empty: true, kpis: null, rows: [] },
      meta: { source: 'recompute', reason: 'NO_PUBLISHED_SNAPSHOT' },
    };
  }

  // Pull raw sub-scores + daily GB per index::sourcetype from the latest snapshot.
  // agent_decisions holds the deterministic U/D/Q/gap; telemetry_snapshots holds
  // the authoritative daily_avg_gb.
  const rowsResult = await query(
    `SELECT
        ad.index_name,
        ad.sourcetype,
        ad.utilization_score,
        ad.detection_score,
        ad.quality_score,
        ad.detection_gap,
        COALESCE(ts.daily_avg_gb, 0) AS daily_avg_gb,
        COALESCE(ts.retention_days, 90) AS retention_days
     FROM agent_decisions ad
     LEFT JOIN LATERAL (
       SELECT daily_avg_gb, retention_days FROM telemetry_snapshots t
       WHERE t.tenant_id = ad.tenant_id
         AND t.snapshot_id = ad.snapshot_id
         AND t.index_name = ad.index_name
         AND (t.sourcetype IS NOT DISTINCT FROM ad.sourcetype)
       ORDER BY t.created_at DESC LIMIT 1
     ) ts ON true
     WHERE ad.tenant_id = $1 AND ad.snapshot_id = $2`,
    [tenantId, publishedRun.snapshotId]
  );

  // Determine the cost rate to apply: explicit override, else preserve each
  // row's existing $/GB/year implied by its persisted annual cost.
  const scored: ScoredSourcetype[] = [];
  const rows = (rowsResult.rows || []).map((r: any) => {
    const utilization = parseFloat(r.utilization_score) || 0;
    const detection = parseFloat(r.detection_score) || 0;
    const quality = parseFloat(r.quality_score) || 0;
    const dailyGb = parseFloat(r.daily_avg_gb) || 0;

    const composite = computeCompositeScore(utilization, detection, quality, weights);
    const tier = assignTier(composite) as TierLabel;
    const annualCostUsd = costPerGbYear !== null ? dailyGb * costPerGbYear : 0;

    const s: ScoredSourcetype = {
      index: r.index_name,
      sourcetype: r.sourcetype,
      utilizationScore: utilization,
      detectionScore: detection,
      qualityScore: quality,
      compositeScore: composite,
      tier,
      dailyGb,
      annualCostUsd,
      detectionGap: Boolean(r.detection_gap),
      operationalGap: false,
    };
    scored.push(s);
    return {
      index: s.index,
      sourcetype: s.sourcetype,
      utilizationScore: utilization,
      detectionScore: detection,
      qualityScore: quality,
      compositeScore: composite,
      tier,
      dailyGb,
      annualCostUsd: Math.round(annualCostUsd * 100) / 100,
    };
  });

  const tierCount = (label: TierLabel) => scored.filter(s => s.tier === label).length;
  const tierSpend = (label: TierLabel) =>
    scored.filter(s => s.tier === label).reduce((sum, s) => sum + s.annualCostUsd, 0);

  const totalDailyGb = scored.reduce((sum, s) => sum + s.dailyGb, 0);
  const totalLicenseSpend = scored.reduce((sum, s) => sum + s.annualCostUsd, 0);

  // Deterministic storage savings (guide §8) — recomputed live with the filter bar's storage rate
  const savingsCfg: Partial<SavingsConfig> = {};
  if (storageCostPerGbMonth !== null) {
    savingsCfg.costPerGbPerDay = storageCostPerGbMonth / 30;
  }
  let storageSavingsPotential = 0;
  for (const r of (rowsResult.rows || []) as any[]) {
    const dagb = parseFloat(r.daily_avg_gb) || 0;
    if (dagb <= 0) continue;
    const retIn: RetentionInput = { dailyAvgGb: dagb, retentionDays: parseInt(r.retention_days) || 90 };
    const compIn: CompressionSavingsInput = { dailyAvgGb: dagb, utilizationPct: parseFloat(r.utilization_score) || 0 };
    const s = computeDeterministicSavings(retIn, null, compIn, savingsCfg);
    storageSavingsPotential += s.totalSavings;
  }
  storageSavingsPotential = Math.round(storageSavingsPotential * 100) / 100;

  return {
    data: {
      empty: false,
      weights,
      costPerGbYear,
      storageCostPerGbMonth,
      kpis: {
        roiScore: computeROIScore(scored),
        gainScopeScore: computeGainScope(scored),
        licenseSpendLowValue: computeLowValueSpend(scored),
        storageSavingsPotential,
        totalLicenseSpend: Math.round(totalLicenseSpend * 100) / 100,
        totalDailyGb: Math.round(totalDailyGb * 1000) / 1000,
        totalSourcetypes: scored.length,
        tierCounts: {
          critical: tierCount('Critical'),
          important: tierCount('Important'),
          niceToHave: tierCount('Nice-to-Have'),
          lowValue: tierCount('Low-Value'),
        },
        tierSpend: {
          critical: Math.round(tierSpend('Critical') * 100) / 100,
          important: Math.round(tierSpend('Important') * 100) / 100,
          niceToHave: Math.round(tierSpend('Nice-to-Have') * 100) / 100,
          lowValue: Math.round(tierSpend('Low-Value') * 100) / 100,
        },
        securityGaps: scored.filter(s => s.detectionGap).length,
      },
      rows,
    },
    meta: {
      source: 'recompute',
      tenantId,
      snapshotId: publishedRun.snapshotId,
      runId: publishedRun.runId,
      recomputedAt: new Date().toISOString(),
    },
  };
});
