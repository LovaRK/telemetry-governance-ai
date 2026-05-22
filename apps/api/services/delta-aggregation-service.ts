import {
  computeGainScope,
  computeLowValueSpend,
  computeROIScore,
  type ScoredSourcetype,
} from './deterministic-scoring-engine';

export interface DeltaSourceRef {
  indexName: string;
  sourcetype: string | null;
  granularity: 'index' | 'sourcetype';
}

export interface DeltaAggregationInput {
  changed: DeltaSourceRef[];
  deleted: DeltaSourceRef[];
  scoredCurrent: ScoredSourcetype[];
}

export interface DeltaAggregationOutput {
  affectedKpis: Array<'ROI' | 'GAINSCOPE' | 'SAVINGS'>;
  affectedSourcetypes: string[];
  recomputed: Array<{ kpi: 'ROI' | 'GAINSCOPE' | 'SAVINGS'; value: number }>;
}

/**
 * P7.3 delta engine: recompute only KPI set affected by changed/deleted sources.
 * This is compute-only and intentionally does not publish/write cache/UI.
 */
export function runDeltaAggregation(input: DeltaAggregationInput): DeltaAggregationOutput {
  const impacted = [...input.changed, ...input.deleted];
  if (impacted.length === 0) {
    return { affectedKpis: [], affectedSourcetypes: [], recomputed: [] };
  }

  const affectedSourcetypes = Array.from(
    new Set(
      impacted.map((s) => `${s.indexName}::${s.sourcetype || '_'}`)
    )
  );

  // ROI, GainScope and Savings are portfolio-level deterministic KPIs derived
  // from scored source rows, so any source delta can affect them.
  const affectedKpis: DeltaAggregationOutput['affectedKpis'] = ['ROI', 'GAINSCOPE', 'SAVINGS'];

  const recomputed: DeltaAggregationOutput['recomputed'] = [
    { kpi: 'ROI', value: computeROIScore(input.scoredCurrent) },
    { kpi: 'GAINSCOPE', value: computeGainScope(input.scoredCurrent) },
    { kpi: 'SAVINGS', value: Math.round(computeLowValueSpend(input.scoredCurrent) * 100) / 100 },
  ];

  return {
    affectedKpis,
    affectedSourcetypes,
    recomputed,
  };
}
