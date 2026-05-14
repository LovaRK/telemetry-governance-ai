import { ValueWeights, DEFAULT_VALUE_WEIGHTS } from '../../core/config/weights';

export function calculateValueScore(inputs: {
  search_frequency: number;
  dashboard_references: number;
  alert_dependencies: number;
  anomaly_relevance: number;
}, weights: ValueWeights = DEFAULT_VALUE_WEIGHTS): number {
  const max_search = 100;
  const max_dashboards = 50;
  const max_alerts = 20;
  const max_anomaly = 10;

  const search_score = Math.min(100, (inputs.search_frequency / max_search) * 100);
  const dashboard_score = Math.min(100, (inputs.dashboard_references / max_dashboards) * 100);
  const alert_score = Math.min(100, (inputs.alert_dependencies / max_alerts) * 100);
  const anomaly_score = Math.min(100, (inputs.anomaly_relevance / max_anomaly) * 100);

  const raw_score = 
    (search_score * weights.search_usage) +
    (dashboard_score * weights.dashboard_refs) +
    (alert_score * weights.alert_dependency) +
    (anomaly_score * weights.anomaly_relevance);

  return Math.min(100, Math.max(0, Math.round(raw_score)));
}

export function calculateWasteScore(inputs: {
  daily_gb: number;
  search_frequency: number;
  duplicate_patterns: number;
}): number {
  const volume_factor = Math.min(100, inputs.daily_gb / 10);
  const usage_factor = inputs.search_frequency < 5 ? 30 : inputs.search_frequency < 20 ? 15 : 0;
  const duplicate_factor = Math.min(30, inputs.duplicate_patterns * 5);

  const raw_score = volume_factor + usage_factor + duplicate_factor;
  return Math.min(100, Math.round(raw_score));
}

export function calculateRiskScore(inputs: {
  alert_dependencies: number;
  compliance_requirement: number;
  business_criticality: number;
}): number {
  const alert_factor = Math.min(50, inputs.alert_dependencies * 10);
  const compliance_factor = inputs.compliance_requirement * 30;
  const criticality_factor = inputs.business_criticality * 20;

  const raw_score = alert_factor + compliance_factor + criticality_factor;
  return Math.min(100, Math.round(raw_score));
}

export function generateDecisionTraceId(): string {
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}