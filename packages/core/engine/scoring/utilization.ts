/**
 * UTILIZATION SCORING
 * Pure function: (alerts × 3) + (scheduled × 3) + (dashboards × 2) + (adhoc × 1) + (users × 2)
 * Result: 0-100 relative to highest-use sourcetype
 */

import type { UtilizationInputs } from '../types';

/** Scoring sub-module version. Matches SCORING_VERSION in composite.ts. */
export const SCORING_VERSION = '1.0';

export function computeUtilizationScores(inputs: UtilizationInputs[]): Map<string, number> {
  const weightedSums = new Map<string, number>();

  for (const inp of inputs) {
    const key = `${inp.index}::${inp.sourcetype || '_'}`;
    const ws =
      inp.alertCount * 3 +
      inp.scheduledSearchCount * 3 +
      inp.dashboardPanelCount * 2 +
      inp.adHocSearchCount * 1 +
      inp.distinctUserCount * 2;
    weightedSums.set(key, ws);
  }

  const maxWeightedSum = Math.max(...weightedSums.values(), 1);

  const scores = new Map<string, number>();
  for (const [key, ws] of weightedSums) {
    scores.set(key, Math.round((ws / maxWeightedSum) * 100 * 10) / 10);
  }

  return scores;
}
