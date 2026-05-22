/**
 * DETERMINISTIC ENGINE - Main Export
 * Pure functions for reproducible, auditable scoring
 */

export { computeUtilizationScores } from './scoring/utilization';
export { computeDetectionScores } from './scoring/detection';
export { computeQualityScore } from './scoring/quality';
export {
  computeCompositeScore,
  DEFAULT_WEIGHTS,
  SCORING_PROFILES,
  validateWeights,
  extractWeightsFromConfig,
} from './scoring/composite';
export { assignTier, TIER_THRESHOLDS } from './tier';
export {
  computeROIScore,
  computeGainScope,
  computeLowValueSpend,
  computePortfolioKPIs,
  type PortfolioKPIs,
} from './kpi';

// Savings functions
export {
  computeDeterministicSavings,
  computeRetentionExcessGb,
  computeRetentionSavings,
  computeUnusedFieldGb,
  computeFieldSavings,
  computeCompressionOpportunityGb,
  computeCompressionSavings,
  type DeterministicSavings,
} from './savings/storage';

// Attribution validation
export { validateAttribution } from './attribution/validation';

export type {
  UtilizationInputs,
  DetectionInputs,
  QualityInputs,
  ScoringWeights,
  TierLabel,
  ScoredSourcetype,
  DetectionScoreResult,
} from './types';
