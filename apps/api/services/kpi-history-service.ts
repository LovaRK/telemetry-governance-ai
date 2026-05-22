import { query } from '../../../core/database/connection';

const KPI_MAP: Record<string, { column: string; source: string; formulaVersion: string }> = {
  roi: { column: 'roi_score', source: 'executive_kpis', formulaVersion: 'v1' },
  gainscope: { column: 'gainscope_score', source: 'executive_kpis', formulaVersion: 'v1' },
  detection: { column: 'avg_detection', source: 'executive_kpis', formulaVersion: 'v1' },
  savings: { column: 'storage_savings_potential', source: 'executive_kpis', formulaVersion: 'v1' },
  daily_ingest: { column: 'total_daily_gb', source: 'executive_kpis', formulaVersion: 'v1' },
  confidence: { column: 'avg_confidence', source: 'executive_kpis', formulaVersion: 'v1' },
};

function reasonForDelta(kpi: string, delta: number): string {
  const direction = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'did not change';
  return `${kpi} ${direction} based on latest published KPI delta`; 
}

export async function getKpiHistory(tenantId: string, kpiId: string) {
  const cfg = KPI_MAP[kpiId];
  if (!cfg) return null;

  await query(`
    CREATE TABLE IF NOT EXISTS kpi_change_events (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      kpi_name VARCHAR(64) NOT NULL,
      old_value NUMERIC NOT NULL,
      new_value NUMERIC NOT NULL,
      delta NUMERIC NOT NULL,
      formula_version VARCHAR(32) NOT NULL,
      source_origin VARCHAR(64) NOT NULL,
      confidence VARCHAR(16) NOT NULL,
      snapshot_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason TEXT NOT NULL
    );
  `);

  const rows = await query<any>(
    `SELECT snapshot_id, snapshot_date, ${cfg.column} AS value
     FROM executive_kpis
     WHERE tenant_id = $1
     ORDER BY snapshot_date DESC
     LIMIT 2`,
    [tenantId]
  );

  if (rows.rows.length < 2) {
    return {
      before: null,
      after: rows.rows[0]?.value ?? null,
      delta: null,
      evidence: ['Insufficient historical snapshots'],
      reason: 'Not enough published snapshots to compute change',
    };
  }

  const after = Number(rows.rows[0].value ?? 0);
  const before = Number(rows.rows[1].value ?? 0);
  const delta = Number((after - before).toFixed(4));
  const reason = reasonForDelta(kpiId, delta);

  await query(
    `INSERT INTO kpi_change_events
     (tenant_id, kpi_name, old_value, new_value, delta, formula_version, source_origin, confidence, snapshot_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [tenantId, kpiId, before, after, delta, cfg.formulaVersion, cfg.source, 'MEDIUM', rows.rows[0].snapshot_id, reason]
  );

  return {
    before,
    after,
    delta,
    evidence: [
      `source_origin=${cfg.source}`,
      `formula_version=${cfg.formulaVersion}`,
      `snapshot_id=${rows.rows[0].snapshot_id}`,
    ],
    reason,
  };
}
