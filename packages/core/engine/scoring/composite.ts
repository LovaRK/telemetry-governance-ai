/**
 * COMPOSITE SCORING
 * Weighted combination of Utilization, Detection, and Quality
 * Weights must sum to 1.0
 */

import type { ScoringWeights } from '../types';

export const DEFAULT_WEIGHTS: ScoringWeights = {
  utilization: 0.35,
  detection: 0.4,
  quality: 0.25,
};

export const SCORING_PROFILES: Record<string, ScoringWeights> = {
  balanced: { utilization: 0.35, detection: 0.4, quality: 0.25 },
  security_first: { utilization: 0.25, detection: 0.5, quality: 0.25 },
  operations_first: { utilization: 0.5, detection: 0.25, quality: 0.25 },
  data_quality: { utilization: 0.3, detection: 0.3, quality: 0.4 },
};

export function validateWeights(weights: ScoringWeights): void {
  const sum = weights.utilization + weights.detection + weights.quality;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Weights must sum to 1.0. Got: ${sum}`);
  }
}

export function extractWeightsFromConfig(decisionWeights: Record<string, number>): ScoringWeights {
  const w: ScoringWeights = {
    utilization: decisionWeights.utilization ?? DEFAULT_WEIGHTS.utilization,
    detection: decisionWeights.detection ?? DEFAULT_WEIGHTS.detection,
    quality: decisionWeights.quality ?? DEFAULT_WEIGHTS.quality,
  };
  validateWeights(w);
  return w;
}

export function computeCompositeScore(
  utilization: number,
  detection: number,
  quality: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  validateWeights(weights);

  if (!isFinite(utilization)) throw new Error(`Utilization score is not finite: ${utilization}`);
  if (!isFinite(detection)) throw new Error(`Detection score is not finite: ${detection}`);
  if (!isFinite(quality)) throw new Error(`Quality score is not finite: ${quality}`);

  const composite = weights.utilization * utilization + weights.detection * detection + weights.quality * quality;

  return Math.round(composite * 10) / 10;
}
