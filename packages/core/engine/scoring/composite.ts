/**
 * COMPOSITE SCORING
 * Weighted combination of Utilization, Detection, and Quality
 * Weights must sum to 1.0
 */

import type { ScoringWeights } from '../types';

/**
 * Scoring version — increment when scoring logic changes.
 * Every telemetry snapshot row must record this version.
 * Enables point-in-time replay: "What score would this index get under v1.0?"
 *
 * Increment rules:
 * - Patch (1.0.x): algorithm bug fixes — no replay required
 * - Minor (1.x.0): weight default changes — replay recommended
 * - Major (x.0.0): formula changes — replay certification REQUIRED before activation
 */
export const SCORING_VERSION = '1.0';

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

/**
 * Minimum Activity Gate
 *
 * Prevents "clean but useless" data from escaping the Low-Value tier.
 * An index with zero utilization AND zero detection coverage cannot score above 19.9
 * regardless of data quality — high-quality inert data is still inert.
 *
 * Rule: if (utilization < 2 AND detection === 0) → cap composite at 19.9
 *
 * @param composite   - Pre-computed composite score (0–100)
 * @param utilization - Utilization score (0–100)
 * @param detection   - Detection score (0–100)
 * @returns { score: number, gated: boolean } — gated=true means the cap was applied
 */
export function applyMinimumActivityGate(
  composite: number,
  utilization: number,
  detection: number
): { score: number; gated: boolean } {
  const MINIMUM_ACTIVITY_CAP = 19.9;
  const UTILIZATION_THRESHOLD = 2;
  const DETECTION_THRESHOLD = 0;

  if (utilization < UTILIZATION_THRESHOLD && detection <= DETECTION_THRESHOLD) {
    return {
      score: Math.min(composite, MINIMUM_ACTIVITY_CAP),
      gated: true
    };
  }

  return { score: composite, gated: false };
}

/**
 * Compute composite score with minimum activity gate applied.
 * This is the CANONICAL entry point for scoring — always use this over
 * computeCompositeScore() directly when persisting to Gold layer.
 *
 * @returns { composite, utilization, detection, quality, gated, scoring_version }
 */
export function computeGatedCompositeScore(
  utilization: number,
  detection: number,
  quality: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): {
  composite: number;
  utilization: number;
  detection: number;
  quality: number;
  minimum_activity_gated: boolean;
  scoring_version: string;
} {
  const raw = computeCompositeScore(utilization, detection, quality, weights);
  const { score: composite, gated } = applyMinimumActivityGate(raw, utilization, detection);

  return {
    composite,
    utilization: Math.round(utilization * 10) / 10,
    detection: Math.round(detection * 10) / 10,
    quality: Math.round(quality * 10) / 10,
    minimum_activity_gated: gated,
    scoring_version: SCORING_VERSION
  };
}
