import { query } from '../../../core/database/connection';

export interface TelemetrySnapshot {
  id: number;
  snapshotDate: string;
  granularity: 'index' | 'sourcetype';
  parentIndex: string | null;
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
  rawMetadata: Record<string, any>;
}

export interface TelemetryFilters {
  indexName?: string;
  classification?: string;
  granularity?: 'index' | 'sourcetype';
  minRiskScore?: number;
  parentIndex?: string;
  limit?: number;
  offset?: number;
}

/**
 * Retrieve cached telemetry snapshots with optional filters.
 */
export async function getSnapshots(filters: TelemetryFilters = {}): Promise<TelemetrySnapshot[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (filters.indexName) {
    conditions.push(`index_name = $${paramIdx++}`);
    params.push(filters.indexName);
  }
  if (filters.classification) {
    conditions.push(`classification = $${paramIdx++}`);
    params.push(filters.classification);
  }
  if (filters.granularity) {
    conditions.push(`granularity = $${paramIdx++}`);
    params.push(filters.granularity);
  }
  if (filters.minRiskScore !== undefined) {
    conditions.push(`risk_score >= $${paramIdx++}`);
    params.push(filters.minRiskScore);
  }
  if (filters.parentIndex) {
    conditions.push(`parent_index = $${paramIdx++}`);
    params.push(filters.parentIndex);
  }

  // Always restrict to the most recent snapshot date to avoid stale cross-day duplicates
  conditions.push(`snapshot_date = (SELECT MAX(snapshot_date) FROM telemetry_snapshots)`);

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const limitClause = filters.limit ? `LIMIT $${paramIdx++}` : '';
  const offsetClause = filters.offset ? `OFFSET $${paramIdx++}` : '';
  if (filters.limit) params.push(filters.limit);
  if (filters.offset) params.push(filters.offset);

  const result = await query(
    `
    SELECT
      id, snapshot_date, granularity, parent_index, index_name, sourcetype,
      total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year,
      risk_score, classification, confidence, recommendation, evidence, raw_metadata
    FROM telemetry_snapshots
    ${whereClause}
    ORDER BY risk_score DESC, total_events DESC
    ${limitClause} ${offsetClause}
    `,
    params
  );

  return result.rows.map(mapRowToSnapshot);
}

export async function getSnapshotById(id: number): Promise<TelemetrySnapshot | null> {
  const result = await query(
    `SELECT * FROM telemetry_snapshots WHERE id = $1`,
    [id]
  );
  return result.rows.length > 0 ? mapRowToSnapshot(result.rows[0]) : null;
}

export async function getSnapshotCount(filters: TelemetryFilters = {}): Promise<number> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (filters.indexName) { conditions.push(`index_name = $${paramIdx++}`); params.push(filters.indexName); }
  if (filters.classification) { conditions.push(`classification = $${paramIdx++}`); params.push(filters.classification); }
  if (filters.granularity) { conditions.push(`granularity = $${paramIdx++}`); params.push(filters.granularity); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`SELECT COUNT(*) FROM telemetry_snapshots ${whereClause}`, params);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Retrieve KPI metrics for the executive dashboard.
 */
export async function getKpiMetrics(): Promise<{
  totalIndices: number;
  totalSourcetypes: number;
  totalPotentialSavings: number;
  avgConfidence: number;
  highRiskCount: number;
}> {
  // Use the most recent snapshot date, not necessarily today
  const result = await query(`
    WITH latest AS (
      SELECT MAX(snapshot_date) AS d FROM telemetry_snapshots
    )
    SELECT
      COUNT(DISTINCT CASE WHEN granularity = 'index' THEN index_name END) as total_indices,
      COUNT(DISTINCT CASE WHEN granularity = 'sourcetype' THEN index_name || ':' || sourcetype END) as total_sourcetypes,
      SUM(CASE WHEN classification IN ('ELIMINATE', 'ARCHIVE') THEN cost_per_year ELSE 0 END) as total_potential_savings,
      AVG(confidence) as avg_confidence,
      COUNT(CASE WHEN risk_score > 70 THEN 1 END) as high_risk_count
    FROM telemetry_snapshots, latest
    WHERE snapshot_date = latest.d
  `);

  const row = result.rows[0];
  return {
    totalIndices: parseInt(row.total_indices, 10) || 0,
    totalSourcetypes: parseInt(row.total_sourcetypes, 10) || 0,
    totalPotentialSavings: parseFloat(row.total_potential_savings) || 0,
    avgConfidence: parseFloat(row.avg_confidence) || 0,
    highRiskCount: parseInt(row.high_risk_count, 10) || 0,
  };
}

export async function getValueWasteMatrix(): Promise<
  Array<{
    indexName: string;
    sourcetype: string | null;
    utilizationPct: number;
    costPerYear: number;
    riskScore: number;
    classification: string;
    confidence: number;
  }>
> {
  const result = await query(`
    SELECT
      index_name, sourcetype, utilization_pct, cost_per_year,
      risk_score, classification, confidence
    FROM telemetry_snapshots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM telemetry_snapshots)
      AND granularity = 'index'
    ORDER BY risk_score DESC
  `);

  return result.rows.map((row) => ({
    indexName: row.index_name,
    sourcetype: row.sourcetype,
    utilizationPct: parseFloat(row.utilization_pct),
    costPerYear: parseFloat(row.cost_per_year),
    riskScore: parseFloat(row.risk_score),
    classification: row.classification,
    confidence: parseFloat(row.confidence),
  }));
}

function mapRowToSnapshot(row: any): TelemetrySnapshot {
  return {
    id: row.id,
    snapshotDate: row.snapshot_date,
    granularity: row.granularity,
    parentIndex: row.parent_index,
    indexName: row.index_name,
    sourcetype: row.sourcetype,
    totalEvents: parseInt(row.total_events, 10),
    dailyAvgGb: parseFloat(row.daily_avg_gb),
    retentionDays: row.retention_days,
    utilizationPct: parseFloat(row.utilization_pct),
    costPerYear: parseFloat(row.cost_per_year),
    riskScore: parseFloat(row.risk_score),
    classification: row.classification,
    confidence: parseFloat(row.confidence),
    recommendation: row.recommendation,
    evidence: Array.isArray(row.evidence) ? row.evidence : JSON.parse(row.evidence || '[]'),
    rawMetadata: typeof row.raw_metadata === 'string' ? JSON.parse(row.raw_metadata) : row.raw_metadata || {},
  };
}
