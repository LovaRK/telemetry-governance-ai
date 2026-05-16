/**
 * @deprecated This file is deprecated. All decision logic now comes from TelemetryDecisionAgent (llm-decision-agent.ts).
 * The LLM makes all scoring decisions - no hardcoded weights or thresholds.
 */

export interface ValueWeights {
  search_usage: number;
  dashboard_refs: number;
  alert_dependency: number;
  anomaly_relevance: number;
}

export const DEFAULT_VALUE_WEIGHTS: ValueWeights = {
  search_usage: 0.35,
  dashboard_refs: 0.20,
  alert_dependency: 0.25,
  anomaly_relevance: 0.20
};

export function validateWeights(weights: ValueWeights): boolean {
  const sum = weights.search_usage + weights.dashboard_refs + weights.alert_dependency + weights.anomaly_relevance;
  return Math.abs(sum - 1.0) < 0.001;
}

export interface ScoringConfig {
  weights: ValueWeights;
  thresholds: {
    keep_min_value: number;
    optimize_waste_min: number;
    eliminate_waste_min: number;
    eliminate_value_max: number;
  };
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: DEFAULT_VALUE_WEIGHTS,
  thresholds: {
    keep_min_value: 50,
    optimize_waste_min: 40,
    eliminate_waste_min: 60,
    eliminate_value_max: 25
  }
};