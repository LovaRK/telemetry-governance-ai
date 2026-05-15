import { PoolClient } from 'pg';
import { SplunkClient, SplunkQueryResult } from './splunk-client';
import { scoreTelemetry } from './scoring-service';
import { query, transaction } from '../../../core/database/connection';

export interface AggregationConfig {
  lookbackDays: number;
  incremental: boolean;
}

export interface AggregationResult {
  inserted: number;
  updated: number;
  errors: number;
  durationMs: number;
}

const DEFAULT_CONFIG: AggregationConfig = {
  lookbackDays: 30,
  incremental: true,
};

const SOURCETYPE_DRILLDOWN_GB = 0.1;
const MAX_SOURCETYPE_INDEXES = 20;
// GB cost per day: $0.50/GB/day heuristic
const COST_PER_GB_PER_DAY = 0.50;

export async function runAggregation(
  splunk: SplunkClient,
  config: AggregationConfig = DEFAULT_CONFIG
): Promise<AggregationResult> {
  const start = Date.now();
  let inserted = 0;
  let errors = 0;

  // 1. Fetch all index metadata via REST (no event scanning)
  const indexMetrics = await splunk.getIndexMetrics();

  if (indexMetrics.length === 0) {
    throw new Error('Splunk returned 0 indexes. Check index permissions.');
  }

  // 2. Batch sourcetype query for high-volume indexes
  const highVolumeIndexes = indexMetrics
    .filter(m => m.dailyAvgGb >= SOURCETYPE_DRILLDOWN_GB)
    .sort((a, b) => b.dailyAvgGb - a.dailyAvgGb)
    .slice(0, MAX_SOURCETYPE_INDEXES)
    .map(m => m.index);

  let sourcetypeMetrics: SplunkQueryResult[] = [];
  if (highVolumeIndexes.length > 0) {
    try {
      sourcetypeMetrics = await splunk.getBatchSourcetypeMetrics(highVolumeIndexes);
    } catch (e) {
      console.warn('Sourcetype batch failed (index data still used):', e instanceof Error ? e.message : e);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const allMetrics: Array<{ metric: SplunkQueryResult; granularity: 'index' | 'sourcetype'; parentIndex?: string }> = [
    ...indexMetrics.map(m => ({ metric: m, granularity: 'index' as const })),
    ...sourcetypeMetrics.map(m => ({ metric: m, granularity: 'sourcetype' as const, parentIndex: m.index })),
  ];

  // 3. Score + write everything in one transaction with per-row savepoints
  await transaction(async (client) => {
    let savepointIdx = 0;

    for (const { metric, granularity, parentIndex } of allMetrics) {
      const sp = `sp_${savepointIdx++}`;
      try {
        await client.query(`SAVEPOINT ${sp}`);
        await upsertScoredSnapshot(client, metric, granularity, today, parentIndex);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        inserted++;
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors++;
        console.error(`Upsert failed for ${granularity} ${metric.index}${metric.sourcetype ? ':' + metric.sourcetype : ''}:`, e instanceof Error ? e.message : e);
      }
    }

    await updateCacheMetadata(client, 'index_metrics', inserted);
  });

  return { inserted, updated: 0, errors, durationMs: Date.now() - start };
}

function computeCostPerYear(dailyAvgGb: number): number {
  return Math.round(dailyAvgGb * 365 * COST_PER_GB_PER_DAY * 100) / 100;
}

async function upsertScoredSnapshot(
  client: PoolClient,
  metric: SplunkQueryResult,
  granularity: 'index' | 'sourcetype',
  today: string,
  parentIndex?: string
): Promise<void> {
  const costPerYear = computeCostPerYear(metric.dailyAvgGb);

  const score = scoreTelemetry({
    index: metric.index,
    sourcetype: metric.sourcetype,
    totalEvents: metric.totalEvents,
    dailyAvgGb: metric.dailyAvgGb,
    retentionDays: metric.retentionDays,
    utilizationPct: 0, // populated by usage data when available
    costPerYear,
  });

  await client.query(
    `
    INSERT INTO telemetry_snapshots (
      snapshot_date, granularity, parent_index, index_name, sourcetype,
      total_events, daily_avg_gb, retention_days,
      utilization_pct, cost_per_year, risk_score,
      classification, confidence, recommendation, evidence,
      raw_metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT ON CONSTRAINT uq_snapshot_identity DO UPDATE SET
      total_events    = EXCLUDED.total_events,
      daily_avg_gb    = EXCLUDED.daily_avg_gb,
      retention_days  = EXCLUDED.retention_days,
      cost_per_year   = EXCLUDED.cost_per_year,
      risk_score      = EXCLUDED.risk_score,
      classification  = EXCLUDED.classification,
      confidence      = EXCLUDED.confidence,
      recommendation  = EXCLUDED.recommendation,
      evidence        = EXCLUDED.evidence,
      raw_metadata    = EXCLUDED.raw_metadata,
      updated_at      = NOW()
    `,
    [
      today,
      granularity,
      parentIndex || null,
      metric.index,
      metric.sourcetype || null,
      metric.totalEvents,
      metric.dailyAvgGb,
      metric.retentionDays,
      0,           // utilization_pct
      costPerYear,
      score.riskScore,
      score.classification,
      score.confidence,
      score.recommendation,
      JSON.stringify(score.evidence),
      JSON.stringify({ firstEvent: metric.firstEvent, lastEvent: metric.lastEvent }),
    ]
  );
}

async function updateCacheMetadata(client: PoolClient, key: string, count: number): Promise<void> {
  await client.query(
    `
    INSERT INTO cache_metadata (cache_key, last_refresh_at, next_refresh_at, status, record_count)
    VALUES ($1, NOW(), NOW() + INTERVAL '6 hours', 'fresh', $2)
    ON CONFLICT (cache_key)
    DO UPDATE SET
      last_refresh_at = EXCLUDED.last_refresh_at,
      next_refresh_at = EXCLUDED.next_refresh_at,
      status          = 'fresh',
      record_count    = EXCLUDED.record_count,
      updated_at      = NOW()
    `,
    [key, count]
  );
}
