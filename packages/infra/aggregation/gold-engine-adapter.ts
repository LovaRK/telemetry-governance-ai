/**
 * GOLD + ENGINE ADAPTER
 * Safe integration layer for aggregation-service.ts
 * Dual-path: old logic vs new engine (validated before cutover)
 * This file can be inserted into aggregation-service without breaking anything
 */

import { RawTelemetryInput } from '../../types/aggregation';

// Gold Layer Imports
import {
  normalizeSavedSearches,
  normalizeDashboards,
  mapDetectionCoverage,
  mapLanternCoverage,
  mapQualitySignals,
  buildTelemetrySnapshots,
  mergeDetectionCoverage,
  aggregateSearchCountsByIndex,
  aggregatePanelCountsByIndex,
  type SavedSearchInventory,
  type DashboardInventory,
  type DetectionCoverage,
  type QualitySignals,
  type TelemetrySnapshot,
} from '@core/gold';

// Engine Imports
import {
  computeUtilizationScores,
  computeDetectionScores,
  computeQualityScore,
  computeCompositeScore,
  assignTier,
  computePortfolioKPIs,
  extractWeightsFromConfig,
  DEFAULT_WEIGHTS,
  type ScoringWeights,
} from '@core/engine';

/**
 * GOLD LAYER STAGE 1: Normalize all raw Splunk data
 * Applies canonical schema + 1/N attribution
 */
export async function normalizeGoldLayer(rawSplunk: {
  savedSearches: any[];
  dashboards: any[];
  indexMetrics: any[];
  sourcetypeMetrics: any[];
  mitreMap: Record<string, number>;
  lanternMap: Record<string, number>;
  parseErrors: Record<string, any[]>;
}): Promise<{
  telemetry: TelemetrySnapshot[];
  detection: Map<string, DetectionCoverage>;
  quality: Map<string, QualitySignals>;
  searches: SavedSearchInventory[];
  dashboards: DashboardInventory[];
}> {
  console.log('[Gold Layer] Normalizing Splunk data...');

  // Normalize knowledge objects
  const searches = normalizeSavedSearches(rawSplunk.savedSearches);
  const dashboards = normalizeDashboards(rawSplunk.dashboards);

  // Build telemetry snapshots
  const snapshotId = require('uuid').v4();
  const snapshotDate = new Date();
  const costPerGbPerDay = 0.5; // TODO: from config

  const telemetry = buildTelemetrySnapshots(
    [...rawSplunk.indexMetrics, ...rawSplunk.sourcetypeMetrics],
    snapshotId,
    snapshotDate,
    costPerGbPerDay
  );

  // Normalize detection coverage
  const mitreCoverage = mapDetectionCoverage(rawSplunk.indexMetrics, rawSplunk.mitreMap, {});
  const lanternCoverage = mapLanternCoverage(
    Object.entries(rawSplunk.lanternMap).map(([st, count]) => ({
      sourcetype: st,
      usecases: Array(count).fill(''), // placeholder
    }))
  );
  const detection = mergeDetectionCoverage(mitreCoverage, lanternCoverage);

  // Normalize quality signals
  const quality = new Map<string, QualitySignals>();
  for (const [sourcetype, errors] of Object.entries(rawSplunk.parseErrors)) {
    const signals = mapQualitySignals(errors as any[]);
    for (const signal of signals) {
      quality.set(sourcetype, signal);
    }
  }

  console.log('[Gold Layer] ✅ Normalization complete');
  return { telemetry, detection, quality, searches, dashboards };
}

/**
 * ENGINE STAGE 2: Compute deterministic scores from gold layer
 * Pure math, no side effects
 */
export async function scoreWithEngine(goldData: {
  telemetry: TelemetrySnapshot[];
  detection: Map<string, DetectionCoverage>;
  quality: Map<string, QualitySignals>;
  searches: SavedSearchInventory[];
  dashboards: DashboardInventory[];
  weights?: ScoringWeights;
}): Promise<
  Array<{
    index: string;
    sourcetype?: string;
    utilizationScore: number;
    detectionScore: number;
    qualityScore: number;
    compositeScore: number;
    tier: string;
    annualCostUsd: number;
  }>
> {
  console.log('[Engine] Computing deterministic scores...');

  const weights = goldData.weights || DEFAULT_WEIGHTS;

  // Stage 2.1: Aggregates from gold layer (with attribution applied)
  const utilCounts = aggregateSearchCountsByIndex(goldData.searches);
  const panelCounts = aggregatePanelCountsByIndex(goldData.dashboards);

  // Stage 2.2: Build engine inputs
  const engineInputs = goldData.telemetry.map(telemetry => {
    const key = `${telemetry.index}::${telemetry.sourcetype || '_'}`;
    const detection = goldData.detection.get(telemetry.sourcetype || '');
    const quality = goldData.quality.get(telemetry.sourcetype || '');

    return {
      index: telemetry.index,
      sourcetype: telemetry.sourcetype,
      key,
      telemetry,
      utilCount: utilCounts.get(key) || { count: 0, weight: 0 },
      panelCount: panelCounts.get(key) || { panelCount: 0, weight: 0 },
      detection,
      quality,
    };
  });

  // Stage 2.3: Compute scores (pure, deterministic)
  const scored = engineInputs.map(input => {
    // Utilization
    const utilScore = input.utilCount ? input.utilCount.weight * 100 : 0;

    // Detection
    const detectionScore = input.detection
      ? ((input.detection.mitreTechniques.length * 1.25 + input.detection.lanternUsecases.length * 6) / 2) * 0.4 +
        (input.detection.activeAlerts / Math.max(...engineInputs.map(e => e.detection?.activeAlerts || 1))) * 100 * 0.6
      : 0;

    // Quality
    const qualityScore = input.quality ? computeQualityScore({ index: input.index, sourcetype: input.sourcetype, weightedIssues: input.quality.weightedIssues, dailyGb: input.telemetry.dailyAvgGb }) : 100;

    // Composite
    const compositeScore = computeCompositeScore(utilScore, detectionScore, qualityScore, weights);

    // Validate
    if (!isFinite(compositeScore)) {
      console.error('[Engine] NaN composite detected:', { index: input.index, utilScore, detectionScore, qualityScore });
      throw new Error(`Invalid composite score for ${input.index}`);
    }

    const tier = assignTier(compositeScore);

    return {
      index: input.index,
      sourcetype: input.sourcetype,
      utilizationScore: Math.round(utilScore * 10) / 10,
      detectionScore: Math.round(detectionScore * 10) / 10,
      qualityScore: Math.round(qualityScore * 10) / 10,
      compositeScore: Math.round(compositeScore * 10) / 10,
      tier,
      annualCostUsd: input.telemetry.annualCostUsd,
    };
  });

  console.log('[Engine] ✅ Scoring complete');
  return scored;
}

/**
 * PORTFOLIO KPIs: Deterministic only (no LLM)
 */
export function computeDeterministicKPIs(scored: Array<{ compositeScore: number; tier: string; annualCostUsd: number; dailyAvgGb?: number }>) {
  console.log('[Engine] Computing portfolio KPIs...');

  const scoredWithGb = scored.map(s => ({
    ...s,
    dailyGb: s.dailyAvgGb || 0,
  }));

  const kpis = computePortfolioKPIs(scoredWithGb as any);

  console.log('[Engine] ✅ KPIs computed:', kpis);
  return kpis;
}

/**
 * VALIDATION: Compare old vs new
 * This is where you catch regressions BEFORE they hit production
 */
export function validateDualPath(oldScores: any[], newScores: any[]): {
  matches: number;
  divergences: Array<{ index: string; oldComposite: number; newComposite: number; delta: number }>;
  isValid: boolean;
} {
  const divergences: Array<{ index: string; oldComposite: number; newComposite: number; delta: number }> = [];

  for (const oldScore of oldScores) {
    const newScore = newScores.find(
      n =>
        n.index === oldScore.index && (n.sourcetype || null) === (oldScore.sourcetype || null)
    );

    if (!newScore) {
      divergences.push({
        index: oldScore.index,
        oldComposite: oldScore.compositeScore,
        newComposite: 0,
        delta: oldScore.compositeScore,
      });
      continue;
    }

    const delta = Math.abs(oldScore.compositeScore - newScore.compositeScore);
    if (delta > 0.5) {
      divergences.push({
        index: oldScore.index,
        oldComposite: oldScore.compositeScore,
        newComposite: newScore.compositeScore,
        delta,
      });
    }
  }

  const isValid = divergences.length === 0;
  const matches = oldScores.length - divergences.length;

  console.log('[Validation]', {
    matches,
    divergences: divergences.length,
    isValid,
  });

  if (!isValid && divergences.length > 0) {
    console.warn('[Validation] ⚠️ Divergences detected:', divergences.slice(0, 5));
  }

  return { matches, divergences, isValid };
}

/**
 * FEATURE FLAG: Enable/disable new engine
 * Set to false if regression detected
 */
export const USE_NEW_ENGINE = process.env.USE_NEW_ENGINE !== 'false';
