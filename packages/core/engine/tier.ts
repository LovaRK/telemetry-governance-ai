/**
 * TIER ASSIGNMENT ENGINE
 * Maps composite scores to business tiers (Critical, Important, Nice-to-Have, Low-Value)
 */

import type { TierLabel } from './types';

export const TIER_THRESHOLDS = {
  CRITICAL: 65,
  IMPORTANT: 40,
  NICE_TO_HAVE: 20,
} as const;

export function assignTier(compositeScore: number): TierLabel {
  if (compositeScore >= TIER_THRESHOLDS.CRITICAL) return 'Critical';
  if (compositeScore >= TIER_THRESHOLDS.IMPORTANT) return 'Important';
  if (compositeScore >= TIER_THRESHOLDS.NICE_TO_HAVE) return 'Nice-to-Have';
  return 'Low-Value';
}
