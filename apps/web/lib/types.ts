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

export interface AgentDecision {
  snapshotId: string;
  snapshotDate: string;
  index: string;
  sourcetype: string | null;
  tier: string;
  action: string;
  compositeScore: number;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  riskScore: number;
  annualLicenseCost: number;
  estimatedSavings: number;
  confidence: number;
  confidenceScore: number;
  recommendation: string;
  reasoning: string;
  evidence: any[];
  isQuickWin: boolean;
  isS3Candidate: boolean;
  detectionGap: boolean;
  candidateReason: string[];
}

export interface SnapshotRow {
  indexName: string;
  sourcetype: string | null;
  granularity: string;
  parentIndex: string | null;
  dailyAvgGb: number;
  totalEvents: number;
  retentionDays: number;
  utilizationPct: number;
  costPerYear: number;
  riskScore: number;
  classification: string;
  confidence: number;
  recommendation: string;
  tier: string;
  action: string;
  reasoning: string;
  estimatedSavings: number;
  compositeScore: number;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  isQuickWin: boolean;
  isS3Candidate: boolean;
  detectionGap: boolean;
  snapshotId: string;
  candidateReason?: string[];
}

export interface TierCounts {
  critical: number;
  important: number;
  niceToHave: number;
  lowValue: number;
}

export interface ExecutiveKPIs {
  roiScore: number;
  gainScopeScore: number;
  totalLicenseSpend: number;
  licenseSpendLowValue: number;
  storageSavingsPotential: number;
  totalDailyGb: number;
  totalSourcetypes: number;
  tierCounts: TierCounts;
  securityGaps: number;
  operationalGaps: number;
  avgUtilization: number;
  avgDetection: number;
  avgQuality: number;
  avgConfidence: number;
}

export interface SavingsStep {
  label: string;
  savings: number;
  cumulative: number;
  action: string;
  count: number;
}

export interface QuickWin {
  indexName: string;
  action: string;
  savings: number;
  tier: string;
  reasoning: string;
}

export interface ExecutiveSummary {
  kpis: ExecutiveKPIs;
  quickWins: QuickWin[];
  savingsStaircase: SavingsStep[];
  agentReasoning: string;
  snapshotDate: string;
  snapshots: SnapshotRow[];
  decisions: AgentDecision[];
}

export interface CacheStatus {
  status: 'fresh' | 'stale' | 'empty' | 'error';
  hasEverRefreshed: boolean;
  hasData: boolean;
  hasAgentDecisions: boolean;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  recordCount: number;
  message?: string;
}

export interface FormData {
  mcp_url: string;
  token: string;
  disable_ssl_verify: boolean;
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

export interface TelemetryAsset {
  telemetry_asset: string;
  value_score: number;
  waste_score: number;
  risk_score: number;
  recommendation: { action: string; priority: string };
  estimated_savings?: number;
  criticality?: string;
  evidence: string[];
  scoring_breakdown?: {
    waste_score: number;
    derived_from: { ingest_volume: number; low_search_usage: number; duplicate_patterns: number };
  };
}

export interface DashboardData {
  telemetry_assets?: any[];
  kpis?: any;
  summary?: any;
  requiresRefresh?: boolean;
}

export interface KPIExplainabilityRecord {
  metricId: string;
  value: number;
  formulaId: string;
  formulaExpression: string;
  inputs: Array<{ key: string; value: number }>;
  computedValue: number;
  sourceTable: string;
  sourceRunId: string;
  sourceSnapshotId: string;
  updatedAt: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceOrigin?: string;
  variance?: string;
  displayLabel?: string;
}
