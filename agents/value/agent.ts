import { ValueAgentInput, ValueAgentOutput } from './types';
import { calculateValueScore, calculateWasteScore, calculateRiskScore, generateDecisionTraceId } from './scorer';
import { determineRecommendation } from './recommendations';
import { DEFAULT_COST_CONFIG, calculateAnnualCost, calculateSavings } from '../../core/config/cost';
import { validateTelemetryAsset, TelemetryAssetSchema } from '../../core/schemas/validation';

export async function runValueAgent(input: ValueAgentInput): Promise<ValueAgentOutput> {
  const { discovery, reasoning } = input;
  const telemetry_assets = [];

  const sourcesToProcess = ((discovery as any).telemetry_assets && (discovery as any).telemetry_assets.length > 0)
    ? (discovery as any).telemetry_assets
    : (discovery as any).high_volume_sources.map((name: string) => ({ name, daily_gb: 12, search_frequency: 2, dashboard_refs: 0, alert_deps: 0, anomaly_frequency: 0 }));

  for (const source of sourcesToProcess) {
    const sourceName = source.name || source;
    const sourceInsights = reasoning.insights.filter(i => 
      i.insight.toLowerCase().includes(sourceName.toLowerCase())
    );
    const evidence = sourceInsights.flatMap(i => i.evidence);
    
    const searchFreq = source.search_frequency ?? (evidence.some(e => e.includes('queried')) ? 15 : 2);
    const dashRefs = source.dashboard_refs ?? (evidence.some(e => e.includes('dashboard')) ? 5 : 0);
    const alertDeps = source.alert_deps ?? (evidence.some(e => e.includes('alert')) ? 3 : 0);
    const anomalyFreq = source.anomaly_frequency ?? (evidence.some(e => e.includes('anomaly')) ? 5 : 0);
    const dailyGb = source.daily_gb ?? 12;

    const value_score = calculateValueScore({
      search_frequency: searchFreq,
      dashboard_references: dashRefs,
      alert_dependencies: alertDeps,
      anomaly_relevance: anomalyFreq
    });

    const waste_score = calculateWasteScore({
      daily_gb: dailyGb,
      search_frequency: searchFreq,
      duplicate_patterns: evidence.filter(e => e.includes('duplicate')).length
    });

    const risk_score = calculateRiskScore({
      alert_dependencies: alertDeps,
      compliance_requirement: (source as any).compliance_tags ? 1 : 0,
      business_criticality: (source as any).business_criticality === 'TIER_0' ? 3 : 1
    });

    const recommendation = determineRecommendation(value_score, waste_score, risk_score, {
      search_frequency: searchFreq,
      daily_gb: dailyGb,
      dashboard_refs: dashRefs
    });

    const annual_cost = calculateAnnualCost(dailyGb, DEFAULT_COST_CONFIG);
    const savings = calculateSavings(annual_cost, recommendation.action);

    const asset = {
      telemetry_asset: sourceName,
      value_score,
      waste_score,
      risk_score,
      recommendation: {
        action: recommendation.action,
        priority: recommendation.priority,
        approval_required: false
      },
      confidence: sourceInsights[0]?.confidence?.score || 0.75,
      estimated_annual_cost: annual_cost,
      estimated_savings: savings,
      criticality: recommendation.action === 'KEEP' ? 'tier-1' : 'tier-2',
      evidence,
      scoring_breakdown: {
        waste_score,
        derived_from: {
          ingest_volume: Math.min(100, Math.round(dailyGb * 3.33)),
          low_search_usage: searchFreq < 10 ? 25 : 0,
          duplicate_patterns: evidence.filter(e => e.includes('duplicate')).length * 5
        }
      },
      decision_trace_id: generateDecisionTraceId(),
      reasoning_mode: 'heuristic+agentic'
    };

    const validated = validateTelemetryAsset(asset);
    telemetry_assets.push(validated);
  }

  if (telemetry_assets.length === 0) {
    return {
      telemetry_assets: [],
      data_freshness_seconds: 0,
      schema_version: 'v1'
    };
  }

  return {
    telemetry_assets,
    data_freshness_seconds: 18,
    schema_version: 'v1'
  };
}