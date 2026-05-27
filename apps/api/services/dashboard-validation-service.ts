import { query } from '@core/database/connection';
import { getExplainabilityForTenant } from './kpi-explainability-service';

type ValidationFailure = {
  widgetKey: string;
  expected: number;
  rendered: number;
  computed: number;
  reason: string;
  evidence: Record<string, unknown>;
};

function almostEqual(a: number, b: number, epsilon = 0.11): boolean {
  return Math.abs(a - b) <= epsilon;
}

async function ensureValidationTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard_validation_runs (
      run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard_validation_failures (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES dashboard_validation_runs(run_id) ON DELETE CASCADE,
      widget_key VARCHAR(128) NOT NULL,
      expected_value NUMERIC(18,4),
      rendered_value NUMERIC(18,4),
      computed_value NUMERIC(18,4),
      reason TEXT NOT NULL,
      evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runDashboardValidation(tenantId: string, forceMismatch = false): Promise<{ runId: string; status: 'passed' | 'failed'; failures: number }> {
  await ensureValidationTables();
  const runInsert = await query<{ run_id: string }>(
    `INSERT INTO dashboard_validation_runs (tenant_id, status) VALUES ($1, 'running') RETURNING run_id`,
    [tenantId]
  );
  const runId = runInsert.rows[0].run_id;

  const explain = await getExplainabilityForTenant(tenantId);
  const failures: ValidationFailure[] = [];

  for (const row of explain) {
    let rendered = Number(row.value || 0);
    const expected = Number(row.value || 0);
    const computed = Number(row.computedValue || 0);
    if (forceMismatch && row.metricId === 'GAINSCOPE') rendered += 7;

    if (!almostEqual(expected, computed) || !almostEqual(rendered, computed)) {
      failures.push({
        widgetKey: row.metricId,
        expected,
        rendered,
        computed,
        reason: 'UI/backend/formula mismatch',
        evidence: {
          formulaExpression: row.formulaExpression,
          sourceRunId: row.sourceRunId,
          sourceSnapshotId: row.sourceSnapshotId,
        },
      });
    }
  }

  if (failures.length > 0) {
    for (const f of failures) {
      await query(
        `INSERT INTO dashboard_validation_failures
          (run_id, widget_key, expected_value, rendered_value, computed_value, reason, evidence_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [runId, f.widgetKey, f.expected, f.rendered, f.computed, f.reason, JSON.stringify(f.evidence)]
      );
    }
  }

  const status = failures.length > 0 ? 'failed' : 'passed';
  await query(
    `UPDATE dashboard_validation_runs
     SET status = $2, completed_at = NOW(), summary = $3::jsonb
     WHERE run_id = $1`,
    [runId, status, JSON.stringify({ totalChecks: explain.length, failures: failures.length, screenshot: null })]
  );

  return { runId, status, failures: failures.length };
}

export async function getLatestValidationRun(tenantId: string) {
  await ensureValidationTables();
  const runRes = await query<any>(
    `SELECT run_id, tenant_id, status, started_at, completed_at, summary
     FROM dashboard_validation_runs
     WHERE tenant_id = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const run = runRes.rows[0];
  if (!run) return null;

  const failRes = await query<any>(
    `SELECT widget_key, expected_value, rendered_value, computed_value, reason, evidence_json, created_at
     FROM dashboard_validation_failures
     WHERE run_id = $1
     ORDER BY created_at ASC`,
    [run.run_id]
  );
  return {
    runId: run.run_id,
    tenantId: run.tenant_id,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    summary: run.summary || {},
    failures: failRes.rows || [],
  };
}

export async function getValidationRunById(tenantId: string, runId: string) {
  await ensureValidationTables();
  const runRes = await query<any>(
    `SELECT run_id, tenant_id, status, started_at, completed_at, summary
     FROM dashboard_validation_runs
     WHERE tenant_id = $1 AND run_id = $2
     LIMIT 1`,
    [tenantId, runId]
  );
  const run = runRes.rows[0];
  if (!run) return null;
  const failRes = await query<any>(
    `SELECT widget_key, expected_value, rendered_value, computed_value, reason, evidence_json, created_at
     FROM dashboard_validation_failures
     WHERE run_id = $1
     ORDER BY created_at ASC`,
    [runId]
  );
  return {
    runId: run.run_id,
    tenantId: run.tenant_id,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    summary: run.summary || {},
    failures: failRes.rows || [],
  };
}
