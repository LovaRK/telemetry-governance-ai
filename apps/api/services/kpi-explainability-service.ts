import { query } from '../../../core/database/connection';
import { getLatestPublishedRun } from '../services/pipeline-ledger-service';

export type FormulaId = 'ROI' | 'GAINSCOPE' | 'DETECTION' | 'SAVINGS';

export interface ExplainabilityRecord {
  metricId: FormulaId;
  value: number;
  formulaId: FormulaId;
  formulaExpression: string;
  inputs: Array<{ key: string; value: number }>;
  computedValue: number;
  sourceTable: string;
  sourceRunId: string;
  sourceSnapshotId: string;
  updatedAt: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const FORMULA_REGISTRY: Record<FormulaId, { expression: string; sourceTable: string }> = {
  ROI: { expression: 'avg(composite_score)', sourceTable: 'agent_decisions' },
  GAINSCOPE: { expression: '(tier12_gb / total_gb) * 100', sourceTable: 'telemetry_snapshots' },
  DETECTION: { expression: '0.4*potential + 0.6*realized', sourceTable: 'agent_decisions' },
  SAVINGS: { expression: 'deterministic_only', sourceTable: 'telemetry_snapshots' },
};

function confidenceFromCount(count: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (count >= 5) return 'HIGH';
  if (count >= 2) return 'MEDIUM';
  return 'LOW';
}

export async function getExplainabilityForTenant(tenantId: string): Promise<ExplainabilityRecord[]> {
  const run = await getLatestPublishedRun(tenantId);
  if (!run) return [];
  const snapshotId = run.snapshotId;

  const [kpiRes, decisionsRes, snapshotRes] = await Promise.all([
    query<any>(
      `SELECT * FROM executive_kpis WHERE tenant_id = $1 AND snapshot_id = $2 LIMIT 1`,
      [tenantId, snapshotId]
    ),
    query<any>(
      `SELECT index_name, composite_score, detection_score, estimated_savings
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2`,
      [tenantId, snapshotId]
    ),
    query<any>(
      `SELECT ts.index_name, ad.tier, ts.daily_avg_gb, ts.cost_per_year
       FROM telemetry_snapshots ts
       LEFT JOIN agent_decisions ad ON ad.snapshot_id = ts.snapshot_id AND ad.index_name = ts.index_name AND ad.tenant_id = ts.tenant_id
       WHERE ts.tenant_id = $1 AND ts.snapshot_id = $2`,
      [tenantId, snapshotId]
    ),
  ]);

  const kpi = kpiRes.rows[0] || {};
  const decisions = decisionsRes.rows || [];
  const snapshots = snapshotRes.rows || [];

  const roiInputs = decisions.map((d: any) => ({
    key: d.index_name || 'unknown',
    value: Number(d.composite_score || 0),
  }));
  const roiComputed = roiInputs.length > 0
    ? roiInputs.reduce((s, i) => s + i.value, 0) / roiInputs.length
    : 0;

  const tier12Gb = snapshots
    .filter((s: any) => /critical|important/i.test(s.tier || ''))
    .reduce((s: number, r: any) => s + Number(r.daily_avg_gb || 0), 0);
  const totalGb = snapshots.reduce((s: number, r: any) => s + Number(r.daily_avg_gb || 0), 0);
  const gainScopeComputed = totalGb > 0 ? (tier12Gb / totalGb) * 100 : 0;

  const detectionInputs = decisions.map((d: any) => ({
    key: d.index_name || 'unknown',
    value: Number(d.detection_score || 0),
  }));
  const detectionComputed = detectionInputs.length > 0
    ? detectionInputs.reduce((s, i) => s + i.value, 0) / detectionInputs.length
    : 0;

  const savingsInputs = snapshots.map((s: any) => ({
    key: s.index_name || 'unknown',
    value: Number(s.cost_per_year || 0),
  }));
  const savingsComputed = Number(kpi.storage_savings_potential || 0);

  const updatedAt = run.publishedAt || run.startedAt;
  return [
    {
      metricId: 'ROI',
      value: Number(kpi.roi_score || 0),
      formulaId: 'ROI',
      formulaExpression: FORMULA_REGISTRY.ROI.expression,
      inputs: roiInputs,
      computedValue: Number(roiComputed.toFixed(4)),
      sourceTable: FORMULA_REGISTRY.ROI.sourceTable,
      sourceRunId: run.runId,
      sourceSnapshotId: snapshotId,
      updatedAt,
      confidence: confidenceFromCount(roiInputs.length),
    },
    {
      metricId: 'GAINSCOPE',
      value: Number(kpi.gainscope_score || 0),
      formulaId: 'GAINSCOPE',
      formulaExpression: FORMULA_REGISTRY.GAINSCOPE.expression,
      inputs: [
        { key: 'tier12_gb', value: Number(tier12Gb.toFixed(6)) },
        { key: 'total_gb', value: Number(totalGb.toFixed(6)) },
      ],
      computedValue: Number(gainScopeComputed.toFixed(4)),
      sourceTable: FORMULA_REGISTRY.GAINSCOPE.sourceTable,
      sourceRunId: run.runId,
      sourceSnapshotId: snapshotId,
      updatedAt,
      confidence: confidenceFromCount(snapshots.length),
    },
    {
      metricId: 'DETECTION',
      value: Number(kpi.avg_detection || 0),
      formulaId: 'DETECTION',
      formulaExpression: FORMULA_REGISTRY.DETECTION.expression,
      inputs: detectionInputs,
      computedValue: Number(detectionComputed.toFixed(4)),
      sourceTable: FORMULA_REGISTRY.DETECTION.sourceTable,
      sourceRunId: run.runId,
      sourceSnapshotId: snapshotId,
      updatedAt,
      confidence: confidenceFromCount(detectionInputs.length),
    },
    {
      metricId: 'SAVINGS',
      value: Number(kpi.storage_savings_potential || 0),
      formulaId: 'SAVINGS',
      formulaExpression: FORMULA_REGISTRY.SAVINGS.expression,
      inputs: savingsInputs,
      computedValue: Number(savingsComputed.toFixed(4)),
      sourceTable: FORMULA_REGISTRY.SAVINGS.sourceTable,
      sourceRunId: run.runId,
      sourceSnapshotId: snapshotId,
      updatedAt,
      confidence: confidenceFromCount(savingsInputs.length),
    },
  ];
}

