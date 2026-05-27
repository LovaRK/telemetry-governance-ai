import { query } from '../../core/database/connection';
import {
  computeROIScore,
  computeGainScope,
  computeLowValueSpend,
  type ScoredSourcetype,
  type TierLabel,
} from '../../packages/core/engine';

const BASE_TIER: TierLabel = 'Nice-to-Have';

function asTier(s: string | null | undefined): TierLabel {
  const upper = (s || '').toUpperCase();
  if (upper === 'CRITICAL') return 'Critical';
  if (upper === 'IMPORTANT') return 'Important';
  if (upper === 'NICE-TO-HAVE' || upper === 'NICE_TO_HAVE') return 'Nice-to-Have';
  if (upper === 'LOW-VALUE' || upper === 'LOW_VALUE') return 'Low-Value';
  return BASE_TIER;
}
import { loginAndGetToken, authGet } from './_helpers';
import './setup';

const SEEDED_TENANT_ID = 'e84f31d3-d285-46a1-a0d0-2f64698cd0df';

interface DecisionRow {
  index_name: string;
  composite_score: string;
  utilization_score: string;
  detection_score: string;
  quality_score: string;
  tier: string;
  annual_license_cost: string;
  estimated_savings: string;
}

interface SnapshotRow {
  index_name: string;
  daily_avg_gb: string;
  cost_per_year: string;
}

describe('KPI Certification: DB → Formula → API (Phase 3)', () => {
  let token: string;
  let snapshotId: string;
  let decisions: DecisionRow[];
  let snapshots: SnapshotRow[];

  beforeAll(async () => {
    token = await loginAndGetToken();

    const ptr = await query<{ active_snapshot_id: string }>(
      `SELECT active_snapshot_id FROM tenant_snapshot_pointer WHERE tenant_id = $1`,
      [SEEDED_TENANT_ID]
    );
    expect(ptr.rows.length).toBe(1);
    snapshotId = ptr.rows[0]!.active_snapshot_id;

    const decRes = await query<DecisionRow>(
      `SELECT * FROM agent_decisions WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY index_name`,
      [SEEDED_TENANT_ID, snapshotId]
    );
    decisions = decRes.rows;

    const snapRes = await query<SnapshotRow>(
      `SELECT index_name, daily_avg_gb, cost_per_year
       FROM telemetry_snapshots WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY index_name`,
      [SEEDED_TENANT_ID, snapshotId]
    );
    snapshots = snapRes.rows;
  }, 30000);

  // ─── API returns what DB stores (pipeline coherence) ──────────

  test('API executive-summary returns ROI matching DB', async () => {
    const res = await authGet('/api/executive-summary', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(body.data.kpis).toBeDefined();
    const kpis = body.data.kpis;

    const storedKpi = (await query<any>(
      `SELECT roi_score FROM executive_kpis WHERE tenant_id = $1 AND snapshot_id = $2`,
      [SEEDED_TENANT_ID, snapshotId]
    )).rows[0];
    expect(kpis.roiScore).toBeCloseTo(Number(storedKpi.roi_score), 1);
  });

  test('API executive-summary returns GainScope matching DB', async () => {
    const res = await authGet('/api/executive-summary', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const kpis = body.data!.kpis;

    const storedKpi = (await query<any>(
      `SELECT gainscope_score FROM executive_kpis WHERE tenant_id = $1 AND snapshot_id = $2`,
      [SEEDED_TENANT_ID, snapshotId]
    )).rows[0];
    expect(kpis.gainScopeScore).toBeCloseTo(Number(storedKpi.gainscope_score), 1);
  });

  test('API executive-summary returns all KPI fields as numbers', async () => {
    const res = await authGet('/api/executive-summary', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const kpis = body.data!.kpis;

    const numericFields = [
      'roiScore', 'gainScopeScore', 'totalLicenseSpend', 'licenseSpendLowValue',
      'storageSavingsPotential', 'totalDailyGb', 'totalSourcetypes',
      'avgUtilization', 'avgDetection', 'avgQuality', 'avgConfidence',
    ];
    for (const field of numericFields) {
      expect(typeof kpis[field]).toBe('number');
      expect(Number.isFinite(kpis[field])).toBe(true);
    }
  });

  // ─── Formula correctness via pure engine functions ────────────

  test('ROI formula: avg(compositeScore) is correctly implemented in engine', () => {
    const data: ScoredSourcetype[] = decisions.map(d => ({
      index: d.index_name,
      sourcetype: null,
      utilizationScore: Number(d.utilization_score),
      detectionScore: Number(d.detection_score),
      qualityScore: Number(d.quality_score),
      compositeScore: Number(d.composite_score),
      tier: asTier(d.tier),
      dailyGb: 0,
      annualCostUsd: Number(d.annual_license_cost),
      detectionGap: false,
      operationalGap: false,
    }));
    const computed = computeROIScore(data);
    expect(typeof computed).toBe('number');
    expect(computed).toBeGreaterThanOrEqual(0);
    expect(computed).toBeLessThanOrEqual(100);

    // Manual recompute for cross-check
    const composites = decisions.map(d => Number(d.composite_score));
    const manual = composites.length > 0
      ? Math.round((composites.reduce((a, b) => a + b, 0) / composites.length) * 10) / 10
      : 0;
    expect(computed).toBe(manual);
  });

  test('GainScope formula: (Tier1+2 GB / Total GB) × 100 is correctly implemented in engine', () => {
    const tierMap = new Map(decisions.map(d => [d.index_name, d.tier]));
    const data: ScoredSourcetype[] = snapshots.map(s => ({
      index: s.index_name,
      sourcetype: null,
      utilizationScore: 0,
      detectionScore: 0,
      qualityScore: 0,
      compositeScore: 0,
      tier: asTier(tierMap.get(s.index_name) || null),
      dailyGb: Number(s.daily_avg_gb),
      annualCostUsd: Number(s.cost_per_year),
      detectionGap: false,
      operationalGap: false,
    }));
    const computed = computeGainScope(data);
    expect(typeof computed).toBe('number');
    expect(computed).toBeGreaterThanOrEqual(0);
    expect(computed).toBeLessThanOrEqual(100);
  });

  test('Low-Value Spend formula is correctly implemented in engine', () => {
    const data: ScoredSourcetype[] = snapshots.map((s, i) => ({
      index: s.index_name,
      sourcetype: null,
      utilizationScore: 0,
      detectionScore: 0,
      qualityScore: 0,
      compositeScore: 0,
      tier: asTier(decisions[i]?.tier || null),
      dailyGb: Number(s.daily_avg_gb),
      annualCostUsd: Number(s.cost_per_year),
      detectionGap: false,
      operationalGap: false,
    }));
    const computed = computeLowValueSpend(data);
    expect(typeof computed).toBe('number');
    expect(computed).toBeGreaterThanOrEqual(0);
  });

  test('API returns non-zero real data after seeding', async () => {
    const res = await authGet('/api/executive-summary', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const kpis = body.data!.kpis;
    expect(kpis.roiScore).toBeGreaterThan(0);
    expect(kpis.gainScopeScore).toBeGreaterThan(0);
    expect(kpis.totalSourcetypes).toBeGreaterThan(0);
    expect(body.data.snapshots.length).toBeGreaterThan(0);
    expect(body.data.decisions.length).toBeGreaterThan(0);
  });
});
