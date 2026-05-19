/**
 * QUALITY SCORING
 * Pure function: max(0, 100 − (issue_density × 2000))
 * Measures data quality based on parsing errors per GB
 */

import type { QualityInputs } from '../types';

export function computeQualityScore(inp: QualityInputs): number {
  if (inp.dailyGb <= 0) return 100;

  const factor = inp.eventsPerGbFactor ?? 1_000_000;
  const approxEvents = inp.dailyGb * factor;
  const issueDensity = inp.weightedIssues / approxEvents;

  return Math.max(0, Math.round((100 - issueDensity * 2000) * 10) / 10);
}
