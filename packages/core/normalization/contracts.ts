/**
 * NORMALIZATION CONTRACT VALIDATORS
 *
 * Runtime type guards and validation for CanonicalTelemetry.
 * Ensures normalized output conforms to contract before reaching scoring.
 */

import type { CanonicalTelemetry, CanonicalCategory } from './canonical';

export function validateCanonical(item: CanonicalTelemetry): string[] {
  const errors: string[] = [];

  if (!item.sourceType || typeof item.sourceType !== 'string') {
    errors.push('Missing or invalid sourceType');
  }

  if (!isCanonicalCategory(item.category)) {
    errors.push(`Invalid category: ${item.category}`);
  }

  if (item.volumeGb < 0 || !isFinite(item.volumeGb)) {
    errors.push(`Invalid volumeGb: ${item.volumeGb}`);
  }

  if (item.events < 0 || !isFinite(item.events)) {
    errors.push(`Invalid events count: ${item.events}`);
  }

  // Validate utilizationInputs
  const ui = item.utilizationInputs;
  if (ui.alertCount < 0 || !isFinite(ui.alertCount)) {
    errors.push(`Invalid alertCount: ${ui.alertCount}`);
  }
  if (ui.scheduledSearchCount < 0 || !isFinite(ui.scheduledSearchCount)) {
    errors.push(`Invalid scheduledSearchCount: ${ui.scheduledSearchCount}`);
  }
  if (ui.dashboardPanelCount < 0 || !isFinite(ui.dashboardPanelCount)) {
    errors.push(`Invalid dashboardPanelCount: ${ui.dashboardPanelCount}`);
  }

  // Validate detectionInputs
  const di = item.detectionInputs;
  if (di.mitreTechniqueCount < 0 || !isFinite(di.mitreTechniqueCount)) {
    errors.push(`Invalid mitreTechniqueCount: ${di.mitreTechniqueCount}`);
  }
  if (di.lanternUsecaseCount < 0 || !isFinite(di.lanternUsecaseCount)) {
    errors.push(`Invalid lanternUsecaseCount: ${di.lanternUsecaseCount}`);
  }
  if (di.activeAlertCount < 0 || !isFinite(di.activeAlertCount)) {
    errors.push(`Invalid activeAlertCount: ${di.activeAlertCount}`);
  }

  // Validate qualityInputs
  const qi = item.qualityInputs;
  if (qi.weightedIssues < 0 || !isFinite(qi.weightedIssues)) {
    errors.push(`Invalid weightedIssues: ${qi.weightedIssues}`);
  }
  if (qi.dailyGb < 0 || !isFinite(qi.dailyGb)) {
    errors.push(`Invalid dailyGb in qualityInputs: ${qi.dailyGb}`);
  }

  if (!item.confidence || !['HIGH', 'MEDIUM', 'LOW'].includes(item.confidence)) {
    errors.push(`Invalid confidence: ${item.confidence}`);
  }

  return errors;
}

function isCanonicalCategory(val: string): val is CanonicalCategory {
  return ['security', 'endpoint', 'infra', 'network', 'cloud', 'application', 'generic'].includes(val);
}

export interface NormalizationDelta {
  oldRoi: number;
  newRoi: number;
  roiVariance: number;
  oldGainScope: number;
  newGainScope: number;
  gainScopeVariance: number;
  oldTierCounts: { critical: number; important: number; niceToHave: number; lowValue: number };
  newTierCounts: { critical: number; important: number; niceToHave: number; lowValue: number };
  normalizedCount: number;
  genericCount: number;
  errorCount: number;
}

export function computeNormalizationDelta(
  oldKpis: { roiScore: number; gainScope: number; tierCounts: { critical: number; important: number; niceToHave: number; lowValue: number } },
  newKpis: { roiScore: number; gainScope: number; tierCounts: { critical: number; important: number; niceToHave: number; lowValue: number } },
  normalizedCount: number,
  genericCount: number,
  errorCount: number
): NormalizationDelta {
  const roiVariance = oldKpis.roiScore === 0
    ? 0
    : Math.abs((newKpis.roiScore - oldKpis.roiScore) / oldKpis.roiScore) * 100;
  const gainScopeVariance = oldKpis.gainScope === 0
    ? 0
    : Math.abs((newKpis.gainScope - oldKpis.gainScope) / oldKpis.gainScope) * 100;

  return {
    oldRoi: oldKpis.roiScore,
    newRoi: newKpis.roiScore,
    roiVariance: Math.round(roiVariance * 100) / 100,
    oldGainScope: oldKpis.gainScope,
    newGainScope: newKpis.gainScope,
    gainScopeVariance: Math.round(gainScopeVariance * 100) / 100,
    oldTierCounts: oldKpis.tierCounts,
    newTierCounts: newKpis.tierCounts,
    normalizedCount,
    genericCount,
    errorCount,
  };
}
