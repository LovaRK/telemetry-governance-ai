#!/usr/bin/env npx ts-node
/**
 * Historical Normalization Replay
 *
 * Replays past N days of telemetry data through both the old scoring path
 * and the new canonical normalization path, computes variance, and persists
 * the results to the normalization_variance table.
 *
 * Usage:
 *   npx ts-node scripts/replay-normalization.ts --days=30
 *
 * Options:
 *   --days=N     Number of days to replay (default: 30, max: 90)
 *   --tenant=X   Replay for a specific tenant (default: all tenants)
 *   --dry-run    Compute but do not persist
 *
 * Exit codes:
 *   0 — replay complete, variance within thresholds
 *   1 — replay complete, variance EXCEEDS thresholds
 *   2 — fatal error
 */

import { pool } from '../core/database/connection';
import { normalizeBatch } from '../packages/core/normalization/index';
import {
  computeROIScore,
  computeGainScope,
  computeLowValueSpend,
  type ScoredSourcetype,
  type TierLabel,
} from '../packages/core/engine';

const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;
const VARIANCE_THRESHOLD_AVG = 2.0;  // fail if avg variance > 2%
const VARIANCE_THRESHOLD_MAX = 5.0;  // fail if any variance > 5%

interface ReplayOptions {
  days: number;
  tenant: string | null;
  dryRun: boolean;
}

interface TenantRunResult {
  tenantId: string;
  snapshotCount: number;
  rawROI: number;
  canonicalROI: number;
  rawGainScope: number;
  canonicalGainScope: number;
  rawLowValue: number;
  canonicalLowValue: number;
  maxVariancePct: number;
}

function parseArgs(): ReplayOptions {
  const args = process.argv.slice(2);
  const opts: ReplayOptions = { days: DEFAULT_DAYS, tenant: null, dryRun: false };

  for (const arg of args) {
    if (arg.startsWith('--days=')) {
      const d = parseInt(arg.split('=')[1], 10);
      opts.days = Math.min(Math.max(d, 1), MAX_DAYS);
    } else if (arg.startsWith('--tenant=')) {
      opts.tenant = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    }
  }

  return opts;
}

async function replayForTenant(
  tenantId: string,
  days: number,
  dryRun: boolean,
): Promise<TenantRunResult | null> {
  const start = Date.now();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  // Fetch snapshots with their agent decisions for the date range
  const snapshotsResult = await pool.query(`
    SELECT
      ts.index_name,
      ts.sourcetype,
      ts.daily_avg_gb,
      ts.total_events,
      ts.retention_days,
      ts.snapshot_date,
      ts.snapshot_id,
      ts.granularity,
      ad.composite_score,
      ad.utilization_score,
      ad.detection_score,
      ad.quality_score,
      ad.tier,
      ad.detection_gap,
      ad.operational_gap,
      ad.annual_license_cost
    FROM telemetry_snapshots ts
    LEFT JOIN agent_decisions ad
      ON ad.snapshot_id = ts.snapshot_id
     AND ad.index_name = ts.index_name
     AND (ad.sourcetype IS NOT DISTINCT FROM ts.sourcetype)
    WHERE ts.snapshot_date >= $1
      AND ts.tenant_id = $2
      AND ad.composite_score IS NOT NULL
    ORDER BY ts.snapshot_date, ts.index_name
  `, [sinceStr, tenantId]);

  const rows = snapshotsResult.rows;
  if (rows.length === 0) {
    console.log(`  ⏭  Tenant ${tenantId.slice(0, 8)}…: No scored snapshots found in ${days}-day window`);
    return null;
  }

  // Build raw scored entries
  const rawScored: ScoredSourcetype[] = rows.map((r: any) => ({
    index: r.index_name,
    sourcetype: r.sourcetype || null,
    utilizationScore: parseFloat(r.utilization_score) || 0,
    detectionScore: parseFloat(r.detection_score) || 0,
    qualityScore: parseFloat(r.quality_score) || 0,
    compositeScore: parseFloat(r.composite_score) || 0,
    tier: (r.tier || 'Low-Value') as TierLabel,
    dailyGb: parseFloat(r.daily_avg_gb) || 0,
    annualCostUsd: parseFloat(r.annual_license_cost) || 0,
    detectionGap: Boolean(r.detection_gap),
    operationalGap: Boolean(r.operational_gap),
  }));

  // Build normalization entries from raw snapshots
  const normEntries = rows.map((r: any) => ({
    index: r.index_name,
    sourcetype: r.sourcetype,
    dailyAvgGb: parseFloat(r.daily_avg_gb) || 0,
    totalEvents: parseInt(r.total_events, 10) || 0,
    retentionDays: parseInt(r.retention_days, 10) || 90,
    costPerGbPerDay: 0.5,
    precomputedScores: {
      utilizationScore: parseFloat(r.utilization_score) || 0,
      detectionScore: parseFloat(r.detection_score) || 0,
      qualityScore: parseFloat(r.quality_score) || 0,
      compositeScore: parseFloat(r.composite_score) || 0,
      tier: (r.tier || 'Low-Value') as string,
      detectionGap: Boolean(r.detection_gap),
      operationalGap: Boolean(r.operational_gap),
      alertCount: 0,
      scheduledSearchCount: 0,
      dashboardPanelCount: 0,
      distinctUserCount: 0,
      adHocSearchCount: 0,
      mitreTechniqueCount: 0,
      lanternUsecaseCount: 0,
      activeAlertCount: 0,
      weightedIssues: 0,
    },
  }));

  // Run normalization
  const { canonical, errors: normErrors } = normalizeBatch(normEntries);

  // Group canonical entries by sourceType (volume-weighted composite aggregation)
  const canonicalGroups = new Map<string, {
    composites: number[]; dailyGbs: number[]; annualCosts: number[];
  }>();

  for (let i = 0; i < canonical.length; i++) {
    const entry = canonical[i];
    const scored = rawScored[i];
    if (!scored) continue;

    const existing = canonicalGroups.get(entry.sourceType) || { composites: [], dailyGbs: [], annualCosts: [] };
    existing.composites.push(scored.compositeScore);
    existing.dailyGbs.push(scored.dailyGb);
    existing.annualCosts.push(scored.annualCostUsd);
    canonicalGroups.set(entry.sourceType, existing);
  }

  // Build canonical scored entries
  const canonicalScored: ScoredSourcetype[] = Array.from(canonicalGroups.entries()).map(([sourceType, group]) => {
    const totalGb = group.dailyGbs.reduce((s, v) => s + v, 0);
    const weightedComposite = totalGb > 0
      ? group.composites.reduce((s, c, i) => s + c * (group.dailyGbs[i] / totalGb), 0)
      : group.composites.reduce((s, c) => s + c, 0) / group.composites.length;

    return {
      index: sourceType, sourcetype: null,
      utilizationScore: 0, detectionScore: 0, qualityScore: 0,
      compositeScore: Math.round(weightedComposite * 10) / 10,
      tier: 'Important' as TierLabel,
      dailyGb: Math.round(totalGb * 100) / 100,
      annualCostUsd: Math.round(group.annualCosts.reduce((s, v) => s + v, 0) * 100) / 100,
      detectionGap: false, operationalGap: false,
    };
  });

  // Compute KPIs for both paths
  const rawROI = computeROIScore(rawScored);
  const rawGainScope = computeGainScope(rawScored);
  const rawLowValue = computeLowValueSpend(rawScored);

  const canonicalROI = computeROIScore(canonicalScored);
  const canonicalGainScope = computeGainScope(canonicalScored);
  const canonicalLowValue = computeLowValueSpend(canonicalScored);

  // Compute max variance
  const variances: number[] = [];
  if (rawROI > 0) variances.push(Math.abs((canonicalROI - rawROI) / rawROI) * 100);
  if (rawGainScope > 0) variances.push(Math.abs((canonicalGainScope - rawGainScope) / rawGainScope) * 100);
  if (rawLowValue > 0) variances.push(Math.abs((canonicalLowValue - rawLowValue) / rawLowValue) * 100);
  const maxVariancePct = variances.length > 0
    ? Math.round(Math.max(...variances) * 100) / 100
    : 0;

  const duration = Date.now() - start;

  console.log(`  Snapshots: ${rows.length} → Canonical groups: ${canonicalScored.length}`);
  console.log(`  Errors: ${normErrors.length} | Generic (LOW confidence): ${canonical.filter(e => e.confidence === 'LOW').length}`);
  console.log(`  ROI:      ${rawROI.toFixed(1)} → ${canonicalROI.toFixed(1)} (${rawROI > 0 ? ((canonicalROI - rawROI) / rawROI * 100).toFixed(2) : '0.00'}%)`);
  console.log(`  GainScope: ${rawGainScope.toFixed(1)}% → ${canonicalGainScope.toFixed(1)}% (${rawGainScope > 0 ? ((canonicalGainScope - rawGainScope) / rawGainScope * 100).toFixed(2) : '0.00'}%)`);
  console.log(`  LowValue:  $${rawLowValue.toFixed(2)} → $${canonicalLowValue.toFixed(2)}`);
  console.log(`  Max variance: ${maxVariancePct}% (in ${duration}ms)`);

  // Persist to normalization_variance
  if (!dryRun) {
    const snapshotId = `replay_${sinceStr}_${tenantId.slice(0, 8)}`;
    try {
      await pool.query(`
        INSERT INTO normalization_variance (
          tenant_id, source_type,
          old_roi, new_roi,
          old_gain_scope, new_gain_scope,
          old_low_value_spend, new_low_value_spend,
          variance_pct, snapshot_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        tenantId, 'replay',
        rawROI, canonicalROI,
        rawGainScope, canonicalGainScope,
        rawLowValue, canonicalLowValue,
        maxVariancePct, snapshotId,
      ]);
      console.log(`  ✓ Persisted variance record (snapshot: ${snapshotId})`);
    } catch (e: any) {
      console.warn(`  ⚠ Failed to persist: ${e.message}`);
    }
  } else {
    console.log(`  🏁 Dry run — not persisted`);
  }

  return {
    tenantId,
    snapshotCount: rows.length,
    rawROI, canonicalROI,
    rawGainScope, canonicalGainScope,
    rawLowValue, canonicalLowValue,
    maxVariancePct,
  };
}

async function main(): Promise<number> {
  const opts = parseArgs();

  console.log('='.repeat(60));
  console.log('NORMALIZATION HISTORICAL REPLAY');
  console.log('='.repeat(60));
  console.log(`  Window: ${opts.days} days`);
  console.log(`  Tenant: ${opts.tenant || 'ALL tenants'}`);
  console.log(`  Mode:   ${opts.dryRun ? 'DRY RUN' : 'LIVE (will persist)'}`);
  console.log('');

  // Find all tenants
  let tenants: string[] = [];
  if (opts.tenant) {
    tenants = [opts.tenant];
  } else {
    const result = await pool.query(`SELECT DISTINCT tenant_id FROM telemetry_snapshots WHERE tenant_id IS NOT NULL`);
    tenants = result.rows.map((r: any) => r.tenant_id).filter(Boolean);
  }

  if (tenants.length === 0) {
    console.log('No tenants found with data.');
    return 0;
  }

  console.log(`Processing ${tenants.length} tenant(s)...\n`);

  const results: TenantRunResult[] = [];
  for (let i = 0; i < tenants.length; i++) {
    const tid = tenants[i];
    console.log(`[${i + 1}/${tenants.length}] Tenant ${tid.slice(0, 8)}…`);
    const result = await replayForTenant(tid, opts.days, opts.dryRun);
    if (result) results.push(result);
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  if (results.length === 0) {
    console.log('No replay data generated.');
    return 0;
  }

  const allVariances = results.map(r => r.maxVariancePct);
  const avgVariance = allVariances.reduce((s, v) => s + v, 0) / allVariances.length;
  const maxVariance = Math.max(...allVariances);
  const blockingEvents = results.filter(r => r.maxVariancePct > VARIANCE_THRESHOLD_MAX).length;

  console.log(`  Tenants analyzed: ${results.length}`);
  console.log(`  Total snapshots:  ${results.reduce((s, r) => s + r.snapshotCount, 0)}`);
  console.log(`  Avg variance:     ${avgVariance.toFixed(2)}%`);
  console.log(`  Max variance:     ${maxVariance.toFixed(2)}%`);
  console.log(`  Blocking events:  ${blockingEvents}`);
  console.log(`  Thresholds:       avg > ${VARIANCE_THRESHOLD_AVG}% | any > ${VARIANCE_THRESHOLD_MAX}%\n`);

  const safe = avgVariance <= VARIANCE_THRESHOLD_AVG && maxVariance <= VARIANCE_THRESHOLD_MAX;
  if (safe) {
    console.log('✅ SAFE TO ENABLE — variance within thresholds');
  } else {
    console.log('❌ BLOCKED — variance exceeds thresholds:');
    if (avgVariance > VARIANCE_THRESHOLD_AVG) console.log(`     avg variance ${avgVariance.toFixed(2)}% > ${VARIANCE_THRESHOLD_AVG}%`);
    if (maxVariance > VARIANCE_THRESHOLD_MAX) console.log(`     max variance ${maxVariance.toFixed(2)}% > ${VARIANCE_THRESHOLD_MAX}%`);
  }

  return safe ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(2);
  });
