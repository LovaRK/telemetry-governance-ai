import { randomUUID } from 'crypto';
import { Pool } from 'pg';
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002';

describe('Integration (live Splunk): governance failure publish isolation', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
    });
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('POST /api/cache -> worker failure must not change published dashboard state', async () => {
    const splunkUrl = process.env.TEST_SPLUNK_MCP_URL;
    const splunkToken = process.env.TEST_SPLUNK_TOKEN;
    if (!splunkUrl || !splunkToken) {
      console.warn('Skipping: TEST_SPLUNK_MCP_URL / TEST_SPLUNK_TOKEN not configured');
      return;
    }

    // Skip cleanly if API is not running.
    const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
    if (!health?.ok) {
      console.warn(`Skipping: API not reachable at ${BASE_URL}`);
      return;
    }

    const tenantId = `it-guard-${Date.now()}`;
    const runA = randomUUID();
    const snapshotA = randomUUID();

    const systemPointer = await pool.query<{
      tenant_id: string;
      model_id: string;
      prompt_id: string;
      current_promotion_id: string;
      decision_contract_version: string;
      config_version: string;
    }>(
      `SELECT tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version::text as config_version
       FROM active_model_pointer
       WHERE tenant_id='SYSTEM'`
    );
    expect(systemPointer.rows.length).toBe(1);

    try {
      // Arrange: seed Published Run A + pointer + data rows.
      await pool.query(
        `INSERT INTO pipeline_runs (
           run_id, snapshot_id, tenant_id, status, published, started_at, published_at,
           pipeline_version, model_version, prompt_version, splunk_query_version
         ) VALUES ($1,$2,$3,'SUCCEEDED',true,NOW(),NOW(),'it','it-model','it-prompt','it-query')`,
        [runA, snapshotA, tenantId]
      );
      await pool.query(
        `INSERT INTO tenant_snapshot_pointer (tenant_id, snapshot_source, active_run_id, active_snapshot_id, updated_at)
         VALUES ($1,'splunk_live',$2,$3,NOW())`,
        [tenantId, runA, snapshotA]
      );
      const publishedBefore = await pool.query<{ run_id: string; snapshot_id: string; published_at: string }>(
        `SELECT run_id, snapshot_id, published_at
         FROM pipeline_runs
         WHERE tenant_id = $1 AND published = true
         ORDER BY published_at DESC
         LIMIT 1`,
        [tenantId]
      );
      expect(publishedBefore.rows.length).toBe(1);
      await pool.query(
        `INSERT INTO telemetry_snapshots (
           tenant_id, snapshot_id, snapshot_date, granularity, index_name, sourcetype,
           total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year, risk_score,
           classification, confidence, recommendation, evidence, raw_metadata
         ) VALUES ($1,$2,CURRENT_DATE,'index','baseline_idx',NULL,1000,2.5,90,40,1200,25,'KEEP',0.8,'Baseline','[]','{}')`,
        [tenantId, snapshotA]
      );
      await pool.query(
        `INSERT INTO executive_kpis (
           tenant_id, snapshot_id, snapshot_date, roi_score, total_daily_gb, total_license_spend, storage_savings_potential
         ) VALUES ($1,$2,CURRENT_DATE,33,2.5,1200,100)`,
        [tenantId, snapshotA]
      );

      // Force governance failure path.
      await pool.query(`DELETE FROM active_model_pointer WHERE tenant_id='SYSTEM'`);

      const token = await loginAndGetToken();
      const postRes = await fetch(`${BASE_URL}/api/cache`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({
          mcpUrl: splunkUrl,
          token: splunkToken,
          tenantId,
          trigger: 'manual',
          window: '30d',
        }),
      });

      expect(postRes.ok).toBe(true);
      const postBody: any = await postRes.json();
      const runB = postBody?.data?.runId as string;
      expect(runB).toBeTruthy();

      // Wait for terminal run state via DB only.
      const terminal = await waitForRunTerminal(pool, runB, 60_000);
      expect(terminal.status).toBe('FAILED');
      expect(terminal.published).toBe(false);
      expect(terminal.error_message || '').toContain('NO_ACTIVE_MODEL_POINTER');

      // Stage lineage invariant.
      const stageRows = await pool.query<{ stage: string; status: string; error_code: string | null; error_type: string | null }>(
        `SELECT stage, status, error_code, error_type
         FROM pipeline_stage_events
         WHERE run_id = $1
         ORDER BY started_at ASC`,
        [runB]
      );

      const stageStatus = stageRows.rows.map((r) => `${r.stage}:${r.status}`);
      expect(stageStatus).toContain('SPLUNK_FETCH:SUCCESS');
      expect(stageStatus).toContain('KPI_AGGREGATION:SUCCESS');
      expect(stageStatus).toContain('AI_DECISIONS:FAILED');
      expect(stageStatus).not.toContain('AI_DECISIONS:SUCCESS');
      expect(stageRows.rows.some((r) => r.stage === 'PUBLISH')).toBe(false);
      const inProgress = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pipeline_stage_events
         WHERE run_id = $1 AND status = 'IN_PROGRESS'`,
        [runB]
      );
      expect(Number(inProgress.rows[0].count)).toBe(0);

      // No partial decisions for failed run.
      const dCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM agent_decisions WHERE run_id = $1`,
        [runB]
      );
      expect(Number(dCount.rows[0].count)).toBe(0);

      // Read isolation: executive-summary remains on published Run A / S1.
      const summaryRes = await fetch(`${BASE_URL}/api/executive-summary`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-tenant-id': tenantId,
        },
      });
      expect(summaryRes.ok).toBe(true);
      const summary: any = await summaryRes.json();
      expect(summary?.meta?.runId).toBe(runA);
      expect(summary?.meta?.snapshotId).toBe(snapshotA);

      const pointer = await pool.query<{ active_run_id: string; active_snapshot_id: string }>(
        `SELECT active_run_id, active_snapshot_id FROM tenant_snapshot_pointer WHERE tenant_id = $1`,
        [tenantId]
      );
      expect(pointer.rows[0].active_run_id).toBe(runA);
      expect(pointer.rows[0].active_snapshot_id).toBe(snapshotA);
      const publishedAfter = await pool.query<{ run_id: string; snapshot_id: string; published_at: string }>(
        `SELECT run_id, snapshot_id, published_at
         FROM pipeline_runs
         WHERE tenant_id = $1 AND published = true
         ORDER BY published_at DESC
         LIMIT 1`,
        [tenantId]
      );
      expect(publishedAfter.rows.length).toBe(1);
      expect(publishedAfter.rows[0].run_id).toBe(publishedBefore.rows[0].run_id);
      expect(publishedAfter.rows[0].snapshot_id).toBe(publishedBefore.rows[0].snapshot_id);
      expect(publishedAfter.rows[0].published_at).toBe(publishedBefore.rows[0].published_at);

      await new Promise((resolve) => setTimeout(resolve, 30_000));
      const delayed = await pool.query<{ status: string; published: boolean }>(
        `SELECT status, published FROM pipeline_runs WHERE run_id = $1`,
        [runB]
      );
      expect(delayed.rows[0].status).toBe('FAILED');
      expect(delayed.rows[0].published).toBe(false);
    } finally {
      // Restore system governance pointer for later tests.
      const p = systemPointer.rows[0];
      await pool.query(
        `INSERT INTO active_model_pointer
         (tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (tenant_id, snapshot_source) DO UPDATE SET
           model_id = EXCLUDED.model_id,
           prompt_id = EXCLUDED.prompt_id,
           current_promotion_id = EXCLUDED.current_promotion_id,
           decision_contract_version = EXCLUDED.decision_contract_version,
           config_version = EXCLUDED.config_version,
           updated_at = NOW()`,
        [p.tenant_id, p.model_id, p.prompt_id, p.current_promotion_id, p.decision_contract_version, Number(p.config_version)]
      );
    }
  }, 90_000);
});

async function waitForRunTerminal(
  pool: Pool,
  runId: string,
  timeoutMs: number
): Promise<{ status: string; published: boolean; error_message: string | null }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await pool.query<{ status: string; published: boolean; error_message: string | null }>(
      `SELECT status, published, error_message FROM pipeline_runs WHERE run_id = $1`,
      [runId]
    );
    if (res.rows.length === 1 && (res.rows[0].status === 'FAILED' || res.rows[0].status === 'SUCCEEDED')) {
      return res.rows[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for terminal run status for run ${runId}`);
}

async function loginAndGetToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@bitso.com', password: 'Admin@12345' }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status}`);
  }
  const body: any = await res.json();
  const token = body?.data?.accessToken;
  if (!token) throw new Error('Missing access token in login response');
  return token;
}
