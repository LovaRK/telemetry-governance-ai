/**
 * DETECTION SCORING
 * Pure function: (0.40 × potential) + (0.60 × realized)
 * With gap detection for security/operational coverage gaps
 */

import type { DetectionInputs, DetectionScoreResult } from '../types';

const DETECTION_GAP_TECHNIQUE_MIN = 15;
const DETECTION_GAP_COVERAGE_MAX = 25;
const OPERATIONAL_GAP_LANTERN_MIN = 4;
const OPERATIONAL_GAP_ALERT_MAX = 0;

export function computeDetectionScores(inputs: DetectionInputs[]): Map<string, DetectionScoreResult> {
  const maxAlertCount = Math.max(...inputs.map(i => i.activeAlertCount), 1);

  const results = new Map<string, DetectionScoreResult>();

  for (const inp of inputs) {
    const key = `${inp.index}::${inp.sourcetype || '_'}`;

    if (inp.mitreTechniqueCount === 0 && inp.lanternUsecaseCount === 0) {
      results.set(key, {
        score: 0,
        detectionGap: false,
        operationalGap: false,
      });
      continue;
    }

    const mitrePotential = Math.min(100, inp.mitreTechniqueCount * 1.25);
    const lanternPotential = Math.min(100, inp.lanternUsecaseCount * 6.0);
    const potential = Math.max(mitrePotential, lanternPotential);
    const realized = (inp.activeAlertCount / maxAlertCount) * 100;
    const score = Math.round((0.4 * potential + 0.6 * realized) * 10) / 10;

    const coveragePct = inp.mitreTechniqueCount > 0 ? (inp.activeAlertCount / inp.mitreTechniqueCount) * 100 : 0;
    const detectionGap = inp.mitreTechniqueCount >= DETECTION_GAP_TECHNIQUE_MIN && coveragePct < DETECTION_GAP_COVERAGE_MAX;

    const operationalGap = inp.lanternUsecaseCount >= OPERATIONAL_GAP_LANTERN_MIN && inp.activeAlertCount <= OPERATIONAL_GAP_ALERT_MAX;

    results.set(key, { score, detectionGap, operationalGap });
  }

  return results;
}
