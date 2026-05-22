import { query } from '../../core/database/connection';

describe('Contract: dashboard truth agent schema foundation', () => {
  test('dashboard_truth_runs and dashboard_truth_failures accept PASS/WARN/BLOCK contract', async () => {
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

    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    for (const status of ['PASS', 'WARN', 'BLOCK']) {
      const ins = await query(
        `INSERT INTO dashboard_truth_runs (tenant_id, status) VALUES ($1, $2) RETURNING run_id`,
        [tenantId, status]
      );
      expect(ins.rows[0].run_id).toBeTruthy();
    }

    await expect(
      query(`INSERT INTO dashboard_truth_runs (tenant_id, status) VALUES ($1, 'INVALID')`, [tenantId])
    ).rejects.toBeTruthy();
  });
});
