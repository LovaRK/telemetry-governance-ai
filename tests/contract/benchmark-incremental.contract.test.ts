import { performance } from 'node:perf_hooks';
import {
  computeGainScope,
  computeLowValueSpend,
  computeROIScore,
  type ScoredSourcetype,
} from '../../apps/api/services/deterministic-scoring-engine';
import { runDeltaAggregation } from '../../apps/api/services/delta-aggregation-service';

type ScaleCase = {
  name: '100GB' | '1TB' | '10TB';
  rows: number;
  changedPct: number;
};

const CASES: ScaleCase[] = [
  { name: '100GB', rows: 10_000, changedPct: 0.01 },
  { name: '1TB', rows: 100_000, changedPct: 0.01 },
  { name: '10TB', rows: 1_000_000, changedPct: 0.005 },
];

describe('Contract: P7.5 incremental benchmark evidence', () => {
  test('incremental recompute outperforms full recompute across scale profiles', () => {
    const summary: Array<{
      scale: string;
      fullMs: number;
      incrementalMs: number;
      speedup: number;
      changedRows: number;
    }> = [];

    for (const c of CASES) {
      const scored = buildScored(c.rows);
      const changedRows = Math.max(1, Math.floor(c.rows * c.changedPct));

      const fullStart = performance.now();
      const full = fullRecompute(scored);
      const fullMs = performance.now() - fullStart;

      const changedRefs = Array.from({ length: changedRows }).map((_, i) => ({
        indexName: `idx_${i}`,
        sourcetype: null as string | null,
        granularity: 'index' as const,
      }));

      const incStart = performance.now();
      const incremental = runDeltaAggregation({
        changed: changedRefs,
        deleted: [],
        scoredCurrent: scored,
      });
      const incrementalMs = performance.now() - incStart;

      // Safety check: incremental still computes deterministic KPI outputs.
      const map = Object.fromEntries(incremental.recomputed.map((x) => [x.kpi, x.value]));
      expect(map.ROI).toBe(full.ROI);
      expect(map.GAINSCOPE).toBe(full.GAINSCOPE);
      expect(map.SAVINGS).toBe(full.SAVINGS);

      const speedup = fullMs / Math.max(incrementalMs, 0.0001);
      summary.push({
        scale: c.name,
        fullMs: round(fullMs),
        incrementalMs: round(incrementalMs),
        speedup: round(speedup),
        changedRows,
      });

      // Core benchmark invariant: incremental path should be strictly faster.
      expect(incrementalMs).toBeLessThan(fullMs);
    }

    // Emit benchmark evidence lines (captured in test logs/artifacts).
    // Example: Full: 240 sec | Incremental: 12 sec | Improvement: 20x
    for (const row of summary) {
      // eslint-disable-next-line no-console
      console.log(
        `[P7.5] ${row.scale} changed=${row.changedRows} | Full: ${row.fullMs}ms | Incremental: ${row.incrementalMs}ms | Improvement: ${row.speedup}x`
      );
    }
  });
});

function fullRecompute(scored: ScoredSourcetype[]) {
  return {
    ROI: computeROIScore(scored),
    GAINSCOPE: computeGainScope(scored),
    SAVINGS: Math.round(computeLowValueSpend(scored) * 100) / 100,
  };
}

function buildScored(rows: number): ScoredSourcetype[] {
  const out: ScoredSourcetype[] = [];
  for (let i = 0; i < rows; i += 1) {
    const util = (i % 100) + 0.1;
    const det = ((i * 3) % 100) + 0.2;
    const qual = ((i * 7) % 100) + 0.3;
    const comp = Math.round((0.35 * util + 0.4 * det + 0.25 * qual) * 10) / 10;

    let tier: ScoredSourcetype['tier'] = 'Low-Value';
    if (comp >= 65) tier = 'Critical';
    else if (comp >= 40) tier = 'Important';
    else if (comp >= 20) tier = 'Nice-to-Have';

    out.push({
      index: `idx_${i}`,
      sourcetype: null,
      utilizationScore: util,
      detectionScore: det,
      qualityScore: qual,
      compositeScore: comp,
      tier,
      dailyGb: ((i % 20) + 1) * 0.5,
      annualCostUsd: ((i % 20) + 1) * 0.5 * 365 * 0.5,
      detectionGap: i % 11 === 0,
      operationalGap: i % 17 === 0,
    });
  }
  return out;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
