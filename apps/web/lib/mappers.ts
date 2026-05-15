import { TelemetryAsset } from './types';

export interface DashboardAsset {
  indexName: string;
  sourcetype: string | null;
  totalEvents: number;
  dailyAvgGb: number;
  retentionDays: number;
  utilizationPct: number;
  costPerYear: number;
  riskScore: number;
  classification: string;
  confidence: number;
  recommendation: string;
  evidence: string[];
}

export function toDashboardAssets(assets: TelemetryAsset[] | any[]): DashboardAsset[] {
  return assets.map((a: any) => ({
    indexName: a.indexName || a.telemetry_asset || 'Unknown',
    sourcetype: a.sourcetype || null,
    totalEvents: a.totalEvents || 0,
    dailyAvgGb: a.dailyAvgGb || (a.scoring_breakdown?.ingest_volume ? a.scoring_breakdown.ingest_volume / 30 : 0),
    retentionDays: a.retentionDays || 90,
    utilizationPct: a.utilizationPct || 0,
    costPerYear: a.costPerYear || a.estimated_savings || 0,
    riskScore: a.riskScore || a.risk_score || 0,
    classification: a.classification || a.recommendation?.action || 'INVESTIGATE',
    confidence: a.confidence || 0.5,
    recommendation: typeof a.recommendation === 'string' ? a.recommendation : (a.recommendation?.action || ''),
    evidence: a.evidence || [],
  }));
}
