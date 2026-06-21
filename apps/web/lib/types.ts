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

export type MetricValue = {
  value: number | null;
  classification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  reason?: string;
  source?: string;
  pipelineRunId?: string;
  generatedAt?: string;
};

export interface ExecutiveKPIs {
  // Tier-A: ROI Score
  roiScore: number | null;
  roiScoreClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Tier-A: GainScope %
  gainScopeScore: number | null;
  gainScopeScoreClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Tier-A: Storage Savings Potential
  storageSavingsPotential: number | null;
  storageSavingsPotentialClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Tier-A: Total License Spend
  totalLicenseSpend: number | null;
  totalLicenseSpendClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Tier-A: License Spend Low Value
  licenseSpendLowValue: number | null;
  licenseSpendLowValueClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Tier-A: Tier Spend Annual (4 metrics)
  tier1SpendAnnual: number | null;
  tier1SpendAnnualClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  tier2SpendAnnual: number | null;
  tier2SpendAnnualClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  tier3SpendAnnual: number | null;
  tier3SpendAnnualClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  tier4SpendAnnual: number | null;
  tier4SpendAnnualClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Tier-A: Average Confidence
  avgConfidence: number | null;
  avgConfidenceClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Supporting: Utilization, Detection, Quality
  avgUtilization: number | null;
  avgUtilizationClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  avgDetection: number | null;
  avgDetectionClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  avgQuality: number | null;
  avgQualityClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';

  // Non-classified fields (existing)
  totalDailyGb: number;
  totalSourcetypes: number;
  tierCounts: TierCounts;
  securityGaps: number;
  operationalGaps: number;
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
  snapshotId?: string;
  runId?: string;
  snapshots: SnapshotRow[];
  decisions: AgentDecision[];
}

export interface CacheStatus {
  status: 'fresh' | 'stale' | 'empty' | 'error';
  hasEverRefreshed: boolean;
  hasData: boolean;
  hasAgentDecisions: boolean;
  hasKpis?: boolean;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  recordCount: number;
  message?: string;
  runId?: string | null;
  snapshotId?: string | null;
  publishedAt?: string | null;
  decisionCount?: number;
  dailyAvgGb?: number;
  snapshotStatus?: SnapshotStatus;
  llmStatus?: LLMStatus;
  pipelineStatus?: PipelineStatus;
  failureCode?: string | null;
  failureReason?: string | null;
  lastRunId?: string | null;
  lastRunAt?: string | null;
  lastDecisionAt?: string | null;
  requestId?: string | null;
  pipelineRunId?: string | null;
  activeJobId?: string | null;
  modelName?: string | null;
  latencyMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  batchCount?: number | null;
  activeState?: Record<string, any>;
  publishedState?: Record<string, any>;
  lastCompletedRun?: {
    runId: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    requestId: string | null;
  } | null;
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

export type SnapshotStatus = 'NOT_READY' | 'READY' | 'FAILED';

export type LLMStatus =
  | 'NOT_STARTED'
  | 'RUNNING'
  | 'READY'
  | 'FAILED'
  | 'FAILED_TIMEOUT';

export type PipelineStatus = 'PENDING' | 'PARTIAL' | 'READY' | 'FAILED';

export interface PipelineLifecycleState {
  requestId: string;
  runId: string;
  tenantId: string;
  snapshotStatus: SnapshotStatus;
  llmStatus: LLMStatus;
  pipelineStatus: PipelineStatus;
  failureCode?:
    | 'MISSING_DECISIONS'
    | 'TIMEOUT'
    | 'RUNTIME'
    | 'FAILED_MODEL_UNAVAILABLE'
    | 'FAILED_MODEL_TIMEOUT'
    | 'FAILED_MODEL_REFUSED'
    | 'FAILED_MODEL_CONTEXT'
    | 'FAILED_MODEL_CRASH'
    | null;
  failureReason?: string | null;
  updatedAt?: string;
  lastRunAt?: string | null;
  lastDecisionAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}
