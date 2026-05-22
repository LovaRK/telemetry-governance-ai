import { query } from '../../../core/database/connection';
import { getExplainabilityForTenant } from './kpi-explainability-service';

export type TruthStatus = 'PASS' | 'WARN' | 'BLOCK';

async function ensureTruthTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard_truth_runs (
      run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      source_run_id UUID,
      source_snapshot_id UUID,
      status VARCHAR(16) NOT NULL CHECK (status IN ('PASS','WARN','BLOCK')),
      checks_total INT NOT NULL DEFAULT 0,
      checks_passed INT NOT NULL DEFAULT 0,
      checks_warned INT NOT NULL DEFAULT 0,
      checks_blocked INT NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS dashboard_truth_failures (
      failure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES dashboard_truth_runs(run_id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL,
      severity VARCHAR(16) NOT NULL CHECK (severity IN ('WARN','BLOCK')),
      widget_id VARCHAR(64) NOT NULL,
      reason_code VARCHAR(64) NOT NULL,
      expected_value NUMERIC,
      actual_value NUMERIC,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function runDashboardTruthAgent(tenantId: string): Promise<{ runId: string; status: TruthStatus }> {
  await ensureTruthTables();
  const started = await query(`INSERT INTO dashboard_truth_runs (tenant_id, status) VALUES ($1, 'PASS') RETURNING run_id`, [tenantId]);
  const runId = started.rows[0].run_id as string;

  try {
    const explain = await getExplainabilityForTenant(tenantId);

    let checksTotal = 0;
    let checksPassed = 0;
    let checksWarned = 0;
    let checksBlocked = 0;

    if (explain.length === 0) {
      checksWarned += 1;
      checksTotal += 1;
      await query(
        `INSERT INTO dashboard_truth_failures
         (run_id, tenant_id, severity, widget_id, reason_code, evidence)
         VALUES ($1, $2, 'WARN', 'dashboard', 'NO_EXPLAINABILITY_ROWS', $3::jsonb)`,
        [runId, tenantId, JSON.stringify({ message: 'Explainability returned no rows' })]
      );
    }

    for (const trace of explain as any[]) {
      checksTotal += 1;
      const value = Number(trace.value);
      const computed = Number(trace.computedValue);
      if (!Number.isFinite(value) || !Number.isFinite(computed)) {
        checksWarned += 1;
        await query(
          `INSERT INTO dashboard_truth_failures
           (run_id, tenant_id, severity, widget_id, reason_code, expected_value, actual_value, evidence)
           VALUES ($1, $2, 'WARN', $3, 'NON_NUMERIC_TRACE', NULL, NULL, $4::jsonb)`,
          [runId, tenantId, trace.metricId || 'unknown', JSON.stringify({ value: trace.value, computedValue: trace.computedValue })]
        );
        continue;
      }

      const delta = Math.abs(value - computed);
      if (delta > 0.01) {
        checksBlocked += 1;
        await query(
          `INSERT INTO dashboard_truth_failures
           (run_id, tenant_id, severity, widget_id, reason_code, expected_value, actual_value, evidence)
           VALUES ($1, $2, 'BLOCK', $3, 'FORMULA_VALUE_MISMATCH', $4, $5, $6::jsonb)`,
          [runId, tenantId, trace.metricId || 'unknown', computed, value, JSON.stringify({ delta, tolerance: 0.01 })]
        );
      } else {
        checksPassed += 1;
      }
    }

    const status: TruthStatus = checksBlocked > 0 ? 'BLOCK' : checksWarned > 0 ? 'WARN' : 'PASS';
    const sourceRunId = explain[0]?.sourceRunId || null;
    const sourceSnapshotId = explain[0]?.sourceSnapshotId || null;

    await query(
      `UPDATE dashboard_truth_runs
       SET status = $2,
           checks_total = $3,
           checks_passed = $4,
           checks_warned = $5,
           checks_blocked = $6,
           source_run_id = $7,
           source_snapshot_id = $8,
           completed_at = NOW()
       WHERE run_id = $1`,
      [runId, status, checksTotal, checksPassed, checksWarned, checksBlocked, sourceRunId, sourceSnapshotId]
    );

    return { runId, status };
  } catch (error: any) {
    await query(
      `UPDATE dashboard_truth_runs
       SET status = 'WARN', error_message = $2, completed_at = NOW()
       WHERE run_id = $1`,
      [runId, error?.message || 'Dashboard truth run failed']
    );
    return { runId, status: 'WARN' };
  }
}

export function triggerDashboardTruthAgent(tenantId: string): void {
  setTimeout(() => {
    runDashboardTruthAgent(tenantId).catch((err) => {
      console.error('[truth-agent] non-blocking run failed:', err);
    });
  }, 0);
}
