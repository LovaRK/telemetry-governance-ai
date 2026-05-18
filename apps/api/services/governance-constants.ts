/**
 * Governance Constants
 *
 * These are deterministic values that MUST NEVER be computed by the LLM.
 * They are facts derived from Splunk, locked to prevent AI hallucination.
 *
 * CRITICAL: LLM may only:
 * - recommend actions based on these facts
 * - explain tradeoffs
 * - prioritize candidates
 *
 * LLM MUST NOT:
 * - invent or recalculate these values
 * - change cost models
 * - override utilization calculations
 */

/**
 * Cost Model Parameters
 * These are configured by the user and locked from LLM modification.
 * The LLM evaluates cost-benefit, but never recalculates cost itself.
 */
export const COST_MODEL_RULES = {
  // Cost is deterministic: dailyAvgGb * costPerGbPerDay * 365
  // User configures costPerGbPerDay (default $0.50/GB/day)
  // LLM receives the computed annual_cost, never recalculates it
  COST_IS_DETERMINISTIC: true,

  // ROI/GainScope scores ARE AI-derived and can vary
  // But they should be grounded in deterministic cost facts
  AI_CAN_SCORE_RECOMMENDATION: true,
  AI_CANNOT_CHANGE_COST_BASIS: true,
} as const;

/**
 * Utilization Metrics
 * These come from deterministic sources and are off-limits to LLM invention.
 */
export const UTILIZATION_RULES = {
  // Utilization % comes from SearchAudit (searches / searches_possible)
  // NOT from LLM estimation
  NEVER_ESTIMATE_UTILIZATION: true,

  // Search frequency comes from audit logs
  // NOT from LLM speculation
  NEVER_ESTIMATE_SEARCH_FREQUENCY: true,

  // Volume metrics come from Splunk
  // NOT from LLM inference
  NEVER_ESTIMATE_VOLUME: true,
} as const;

/**
 * LLM Governance Boundaries
 */
export const LLM_BOUNDARIES = {
  // LLM can recommend: KEEP, OPTIMIZE, ARCHIVE, ELIMINATE
  // But cannot make it dependent on invented metrics
  CAN_RECOMMEND_ACTION: true,

  // LLM can explain why (based on deterministic facts)
  CAN_EXPLAIN_REASONING: true,

  // LLM can score confidence in the recommendation
  CAN_SCORE_CONFIDENCE: true,

  // LLM CANNOT change these deterministic foundations
  CANNOT_CHANGE_COST_MODEL: true,
  CANNOT_INVENT_UTILIZATION: true,
  CANNOT_OVERRIDE_VOLUME_FACTS: true,
  CANNOT_MAKE_AUTONOMOUS_DECISIONS: true,  // Must stay in PROPOSED → REVIEW → APPLIED
} as const;

/**
 * KPI Ownership
 * Clear separation of responsibilities
 */
export const KPI_OWNERSHIP = {
  DETERMINISTIC_LAYER: [
    'total_daily_gb',           // From Splunk
    'total_license_spend',      // From cost model
    'annual_cost_by_index',     // Calculated, never AI-derived
    'retention_days',           // From Splunk
    'search_count_30d',         // From audit logs
    'utilization_pct',          // From audit logs (when available)
  ],

  AI_LAYER: [
    'roi_score',                // AI recommendation strength
    'gain_scope_score',         // AI perception of business impact
    'recommendation',           // KEEP/OPTIMIZE/ARCHIVE/ELIMINATE
    'confidence_score',         // Confidence in the recommendation
    'reasoning',                // Explanation of recommendation
    'priority_rank',            // Which indexes to review first
  ],
} as const;

/**
 * Provenance Requirements
 * Every signal must be tagged with its source
 */
export const PROVENANCE_REQUIREMENTS = {
  // Deterministic signals MUST be tagged "signal_source": "DETERMINISTIC"
  DETERMINISTIC_TAG: 'DETERMINISTIC',

  // Cognitive signals MUST be tagged "signal_source": "AI"
  AI_TAG: 'AI',

  // Every decision must track fingerprint_version to detect schema drift
  REQUIRE_FINGERPRINT_VERSION: true,

  // Every AI signal must track model_version for reproducibility
  REQUIRE_MODEL_VERSION: true,

  // Every AI signal must track prompt_hash for auditing
  REQUIRE_PROMPT_HASH: true,
} as const;

/**
 * Validation Rules
 * Prevent LLM from hallucinating governance values
 */
export function validateDeterministicSignals(signals: any): void {
  if (!signals.signal_source || signals.signal_source !== 'DETERMINISTIC') {
    throw new Error('Deterministic signals must be tagged with signal_source: "DETERMINISTIC"');
  }

  if (typeof signals.cost_per_year_usd !== 'number') {
    throw new Error('cost_per_year_usd must be a number (computed, not estimated)');
  }

  if (signals.cost_per_year_usd < 0) {
    throw new Error('cost_per_year_usd cannot be negative');
  }
}

export function validateCognitiveSignals(signals: any): void {
  if (!signals.signal_source || signals.signal_source !== 'AI') {
    throw new Error('Cognitive signals must be tagged with signal_source: "AI"');
  }

  if (!signals.model_version) {
    throw new Error('Cognitive signals must include model_version for reproducibility');
  }

  if (!signals.prompt_hash) {
    throw new Error('Cognitive signals must include prompt_hash for auditing');
  }

  if (typeof signals.confidence_score !== 'number' || signals.confidence_score < 0 || signals.confidence_score > 1) {
    throw new Error('confidence_score must be a number between 0 and 1');
  }
}

/**
 * UI Labeling
 * How to present these signals to users
 */
export const UI_LABELS = {
  DETERMINISTIC_METRIC: 'Direct Splunk Metric',
  AI_ENRICHED_INSIGHT: 'AI-Enhanced Insight',
  DETERMINISTIC_COLOR: '#4caf50',  // green - facts
  AI_COLOR: '#2196f3',              // blue - reasoning
  HYBRID_COLOR: '#ff9800',          // orange - both layers
} as const;
