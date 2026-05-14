export interface ConnectionState {
  status: string;
  indexes: string[];
  sources: number;
  latency_ms: number;
  error?: string;
}

export interface TimelineEvent {
  timestamp: string;
  agent: string;
  status: string;
  duration_ms: number;
}

export interface UIComponent {
  type: 'metric_card' | 'line_chart' | 'bar_chart' | 'table' | 'insight_card' | 'recommendation_card' | 'timeline_event' | 'status_banner';
  title: string;
  value?: string;
  data_source?: string;
  priority?: string;
  reasoning?: string;
  evidence?: string[];
  source_queries?: string[];
  supporting_metrics?: string[];
  trigger_conditions?: string[];
  raw_query?: string;
}

export interface ScoringBreakdown {
  waste_score: number;
  derived_from: {
    ingest_volume: number;
    low_search_usage: number;
    duplicate_patterns: number;
  };
}

export interface TelemetryAsset {
  telemetry_asset: string;
  value_score: number;
  waste_score: number;
  risk_score: number;
  recommendation: {
    action: string;
    priority: string;
  };
  estimated_savings?: number;
  criticality?: string;
  evidence: string[];
  scoring_breakdown?: ScoringBreakdown;
}

export interface SummaryStats {
  keep: number;
  optimize: number;
  archive: number;
  eliminate: number;
  investigate: number;
  totalPotentialSavings: number;
}

export interface DashboardData {
  connection?: ConnectionState;
  timeline?: TimelineEvent[];
  components?: UIComponent[];
  telemetry_assets?: TelemetryAsset[];
  summary?: {
    totalIndexes: number;
    anomaliesDetected: number;
    wasteIdentified: string;
    recommendationsGenerated: number;
  } & SummaryStats;
  error?: string;
}

export interface FormData {
  mcp_url: string;
  token: string;
}