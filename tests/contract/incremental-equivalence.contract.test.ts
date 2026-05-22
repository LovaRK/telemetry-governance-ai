import {
  computeGainScope,
  computeLowValueSpend,
  computeROIScore,
  type ScoredSourcetype,
} from '../../apps/api/services/deterministic-scoring-engine';
import { runDeltaAggregation } from '../../apps/api/services/delta-aggregation-service';

describe('Contract: full vs incremental equivalence', () => {
  const scoredCurrent: ScoredSourcetype[] = [
    {
      index: 'main', sourcetype: null,
      utilizationScore: 81, detectionScore: 74, qualityScore: 90,
      compositeScore: 81.3, tier: 'Critical',
      dailyGb: 12.5, annualCostUsd: 1800,
      detectionGap: false, operationalGap: false,
    },
    {
      index: 'history', sourcetype: null,
      utilizationScore: 42, detectionScore: 55, qualityScore: 67,
      compositeScore: 53.0, tier: 'Important',
      dailyGb: 8.2, annualCostUsd: 1300,
      detectionGap: false, operationalGap: false,
    },
    {
      index: 'tutorial', sourcetype: null,
      utilizationScore: 14, detectionScore: 20, qualityScore: 52,
      compositeScore: 24.0, tier: 'Nice-to-Have',
      dailyGb: 3.1, annualCostUsd: 450,
      detectionGap: false, operationalGap: true,
    },
  ];

  test('incremental recompute equals full deterministic output (exact)', () => {
    const full = {
      ROI: computeROIScore(scoredCurrent),
      GAINSCOPE: computeGainScope(scoredCurrent),
      SAVINGS: Math.round(computeLowValueSpend(scoredCurrent) * 100) / 100,
      tierCounts: computeTierCounts(scoredCurrent),
    };

    const delta = runDeltaAggregation({
      changed: [{ indexName: 'history', sourcetype: null, granularity: 'index' }],
      deleted: [],
      scoredCurrent,
    });

    const deltaMap = Object.fromEntries(delta.recomputed.map((x) => [x.kpi, x.value]));

    expect(deltaMap.ROI).toBe(full.ROI);
    expect(deltaMap.GAINSCOPE).toBe(full.GAINSCOPE);
    expect(deltaMap.SAVINGS).toBe(full.SAVINGS);

    // Tier counts remain exact because incremental path uses the same scored source set.
    const incrementalTierCounts = computeTierCounts(scoredCurrent);
    expect(incrementalTierCounts).toEqual(full.tierCounts);
  });

  test('equivalence also holds with deleted sources in delta input', () => {
    const full = {
      ROI: computeROIScore(scoredCurrent),
      GAINSCOPE: computeGainScope(scoredCurrent),
      SAVINGS: Math.round(computeLowValueSpend(scoredCurrent) * 100) / 100,
      tierCounts: computeTierCounts(scoredCurrent),
    };

    const delta = runDeltaAggregation({
      changed: [],
      deleted: [{ indexName: 'old-index', sourcetype: null, granularity: 'index' }],
      scoredCurrent,
    });

    const deltaMap = Object.fromEntries(delta.recomputed.map((x) => [x.kpi, x.value]));

    expect(deltaMap.ROI).toBe(full.ROI);
    expect(deltaMap.GAINSCOPE).toBe(full.GAINSCOPE);
    expect(deltaMap.SAVINGS).toBe(full.SAVINGS);
    expect(computeTierCounts(scoredCurrent)).toEqual(full.tierCounts);
  });
});

function computeTierCounts(scored: ScoredSourcetype[]) {
  return scored.reduce(
    (acc, s) => {
      if (s.tier === 'Critical') acc.critical += 1;
      else if (s.tier === 'Important') acc.important += 1;
      else if (s.tier === 'Nice-to-Have') acc.niceToHave += 1;
      else acc.lowValue += 1;
      return acc;
    },
    { critical: 0, important: 0, niceToHave: 0, lowValue: 0 }
  );
}
