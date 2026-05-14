import { TelemetryAsset } from '../../core/schemas/telemetry-asset';

export interface ValueAgentInput {
  discovery: {
    high_volume_sources: string[];
    telemetry_summary: {
      total_indexes: number;
      daily_gb_estimate: number;
    };
  };
  reasoning: {
    insights: Array<{
      insight: string;
      confidence: { score: number; factors: string[] };
      evidence: string[];
    }>;
  };
}

export interface ValueAgentOutput {
  telemetry_assets: TelemetryAsset[];
  data_freshness_seconds: number;
  schema_version: string;
}

export interface ScoringInputs {
  search_frequency: number;
  dashboard_references: number;
  alert_dependencies: number;
  anomaly_relevance: number;
  daily_gb: number;
  duplicate_patterns: number;
  compliance_requirement: number;
  business_criticality: number;
}