import { runDeltaAggregation } from '../../apps/api/services/delta-aggregation-service';
import type { ScoredSourcetype } from '../../apps/api/services/deterministic-scoring-engine';

describe('Contract: delta aggregation engine', () => {
  const scoredCurrent: ScoredSourcetype[] = [
    {
      index: 'main', sourcetype: null,
      utilizationScore: 70, detectionScore: 65, qualityScore: 80,
      compositeScore: 71, tier: 'Critical',
      dailyGb: 10, annualCostUsd: 1000,
      detectionGap: false, operationalGap: false,
    },
    {
      index: 'history', sourcetype: null,
      utilizationScore: 30, detectionScore: 40, qualityScore: 50,
      compositeScore: 39, tier: 'Nice-to-Have',
      dailyGb: 5, annualCostUsd: 600,
      detectionGap: false, operationalGap: false,
    },
  ];

  test('one changed source recomputes only affected KPI set (not full matrix)', () => {
    const out = runDeltaAggregation({
      changed: [{ indexName: 'main', sourcetype: null, granularity: 'index' }],
      deleted: [],
      scoredCurrent,
    });

    expect(out.affectedSourcetypes).toEqual(['main::_']);
    expect(out.affectedKpis.sort()).toEqual(['GAINSCOPE', 'ROI', 'SAVINGS']);
    expect(out.recomputed.map((r) => r.kpi).sort()).toEqual(['GAINSCOPE', 'ROI', 'SAVINGS']);

    // Ensure we are not recomputing unrelated KPI names in this phase.
    expect(out.recomputed.find((r) => r.kpi === ('DETECTION' as any))).toBeUndefined();
  });

  test('empty delta returns no recomputation', () => {
    const out = runDeltaAggregation({ changed: [], deleted: [], scoredCurrent });
    expect(out.affectedKpis).toHaveLength(0);
    expect(out.affectedSourcetypes).toHaveLength(0);
    expect(out.recomputed).toHaveLength(0);
  });
});
