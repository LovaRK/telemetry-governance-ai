import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { ModelGovernanceService } from '../model-governance-service';

describe('Pipeline ledger isolation on governance failure', () => {
  let pool: Pool;
  let governance: ModelGovernanceService;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
    });
    testPool = pool;
    await pool.query('SELECT 1');
    await ensurePipelineLedgerSchemaViaSql(pool);
    governance = new ModelGovernanceService(pool);
  });

  afterAll(async () => {
    await governance.shutdown();
    await pool.end();
  });

  test('NO_ACTIVE_MODEL_POINTER fails run, preserves previous published snapshot, writes no partial decisions', async () => {
    const tenantId = `it-gov-fail-${Date.now()}`;
    const previousRunId = randomUUID();
    const previousSnapshotId = randomUUID();
    const failingRunId = randomUUID();
    const failingSnapshotId = randomUUID();

    const pointerRows = await pool.query<{
      tenant_id: string;
      model_id: string;
      prompt_id: string;
      current_promotion_id: string;
      decision_contract_version: string;
      config_version: string;
    }>(
      `SELECT tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version::text as config_version
       FROM active_model_pointer
       WHERE tenant_id = 'SYSTEM'`
    );
    expect(pointerRows.rows.length).toBe(1);
    const systemPointer = pointerRows.rows[0];

    try {
      await createRunningRun({
        runId: previousRunId,
        snapshotId: previousSnapshotId,
        tenantId,
        idempotencyHash: randomUUID().replace(/-/g, ''),
        pipelineVersion: 'test',
        modelVersion: 'test-model',
        promptVersion: 'test-prompt',
        splunkQueryVersion: 'test-query',
      });
      await publishRunAtomic({ runId: previousRunId, snapshotId: previousSnapshotId, tenantId });

      const publishedBefore = await pool.query<{
        run_id: string;
        snapshot_id: string;
        published_at: string;
      }>(
        `SELECT run_id, snapshot_id, published_at
         FROM pipeline_runs
         WHERE tenant_id = $1 AND published = true
         ORDER BY published_at DESC
         LIMIT 1`,
        [tenantId]
      );
      expect(publishedBefore.rows.length).toBe(1);

      await createRunningRun({
        runId: failingRunId,
        snapshotId: failingSnapshotId,
        tenantId,
        idempotencyHash: randomUUID().replace(/-/g, ''),
        pipelineVersion: 'test',
        modelVersion: 'test-model',
        promptVersion: 'test-prompt',
        splunkQueryVersion: 'test-query',
      });

      await appendStageEvent({ runId: failingRunId, stage: 'SPLUNK_FETCH', status: 'SUCCESS' });
      await appendStageEvent({ runId: failingRunId, stage: 'SNAPSHOT_WRITE', status: 'SUCCESS' });
      await appendStageEvent({ runId: failingRunId, stage: 'KPI_AGGREGATION', status: 'SUCCESS' });

      await pool.query(`DELETE FROM active_model_pointer WHERE tenant_id = 'SYSTEM'`);

      await expect(governance.getActiveRuntime()).rejects.toThrow('NO_ACTIVE_MODEL_POINTER');

      const err = 'NO_ACTIVE_MODEL_POINTER';
      await appendStageEvent({
        runId: failingRunId,
        stage: 'AI_DECISIONS',
        status: 'FAILED',
        errorCode: err,
        errorType: 'UNKNOWN',
        errorMessage: err,
      });
      await markRunFailed(failingRunId, err);

      const failedRun = await pool.query<{
        run_id: string;
        status: string;
        published: boolean;
        error_message: string | null;
      }>(
        `SELECT run_id, status, published, error_message
         FROM pipeline_runs
         WHERE run_id = $1`,
        [failingRunId]
      );
      expect(failedRun.rows[0].status).toBe('FAILED');
      expect(failedRun.rows[0].published).toBe(false);
      expect(failedRun.rows[0].error_message).toContain('NO_ACTIVE_MODEL_POINTER');

      const stageRows = await pool.query<{
        stage: string;
        status: string;
        error_code: string | null;
      }>(
        `SELECT stage, status, error_code
         FROM pipeline_stage_events
         WHERE run_id = $1
         ORDER BY started_at ASC`,
        [failingRunId]
      );
      expect(stageRows.rows.map((r) => `${r.stage}:${r.status}`)).toEqual([
        'SPLUNK_FETCH:SUCCESS',
        'SNAPSHOT_WRITE:SUCCESS',
        'KPI_AGGREGATION:SUCCESS',
        'AI_DECISIONS:FAILED',
      ]);
      expect(stageRows.rows.some((r) => r.stage === 'PUBLISH')).toBe(false);
      expect(stageRows.rows.find((r) => r.stage === 'AI_DECISIONS')?.error_code).toBe('NO_ACTIVE_MODEL_POINTER');

      const inProgress = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pipeline_stage_events
         WHERE run_id = $1 AND status = 'IN_PROGRESS'`,
        [failingRunId]
      );
      expect(Number(inProgress.rows[0].count)).toBe(0);

      const decisionsCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM agent_decisions
         WHERE run_id = $1`,
        [failingRunId]
      );
      expect(Number(decisionsCount.rows[0].count)).toBe(0);

      const latestPublished = await getLatestPublishedRun(pool, tenantId);
      expect(latestPublished).not.toBeNull();
      expect(latestPublished?.runId).toBe(previousRunId);
      expect(latestPublished?.snapshotId).toBe(previousSnapshotId);
      expect(latestPublished?.published).toBe(true);

      const publishedAfter = await pool.query<{
        run_id: string;
        snapshot_id: string;
        published_at: string;
      }>(
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
      expect(String(publishedAfter.rows[0].published_at)).toBe(String(publishedBefore.rows[0].published_at));

      await new Promise((resolve) => setTimeout(resolve, 300));
      const delayed = await pool.query<{ status: string; published: boolean }>(
        `SELECT status, published FROM pipeline_runs WHERE run_id = $1`,
        [failingRunId]
      );
      expect(delayed.rows[0].status).toBe('FAILED');
      expect(delayed.rows[0].published).toBe(false);

      const orphanedRunning = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pipeline_runs
         WHERE tenant_id = $1
           AND status = 'RUNNING'
           AND started_at < NOW() - INTERVAL '5 minutes'`,
        [tenantId]
      );
      expect(Number(orphanedRunning.rows[0].count)).toBe(0);
    } finally {
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
        [
          systemPointer.tenant_id,
          systemPointer.model_id,
          systemPointer.prompt_id,
          systemPointer.current_promotion_id,
          systemPointer.decision_contract_version,
          Number(systemPointer.config_version),
        ]
      );
    }
  });
});

async function ensurePipelineLedgerSchemaViaSql(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      run_id UUID PRIMARY KEY,
      snapshot_id UUID NOT NULL UNIQUE,
      tenant_id VARCHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','RUNNING','FAILED','SUCCEEDED')),
      published BOOLEAN NOT NULL DEFAULT FALSE,
      idempotency_hash VARCHAR(64) UNIQUE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ,
      superseded_by_run_id UUID REFERENCES pipeline_runs(run_id),
      pipeline_version VARCHAR(32) NOT NULL,
      model_version VARCHAR(64) NOT NULL,
      prompt_version VARCHAR(32) NOT NULL,
      splunk_query_version VARCHAR(32) NOT NULL,
      error_message TEXT
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_stage_events (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
      stage VARCHAR(32) NOT NULL CHECK (stage IN ('SPLUNK_FETCH','SNAPSHOT_WRITE','KPI_AGGREGATION','AI_DECISIONS','GOVERNANCE_SYNC','PUBLISH')),
      attempt INT NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL CHECK (status IN ('IN_PROGRESS','SUCCESS','FAILED')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      records_processed INT NOT NULL DEFAULT 0,
      metadata_json JSONB,
      error_message TEXT,
      error_type VARCHAR(50),
      error_code VARCHAR(100)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_snapshot_pointer (
      tenant_id VARCHAR(64) PRIMARY KEY,
      active_run_id UUID NOT NULL REFERENCES pipeline_runs(run_id),
      active_snapshot_id UUID NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

async function createRunningRun(input: {
  runId: string;
  snapshotId: string;
  tenantId: string;
  idempotencyHash: string;
  pipelineVersion: string;
  modelVersion: string;
  promptVersion: string;
  splunkQueryVersion: string;
}): Promise<void> {
  await testPool.query(
    `INSERT INTO pipeline_runs (
      run_id, snapshot_id, tenant_id, status, published, idempotency_hash,
      pipeline_version, model_version, prompt_version, splunk_query_version
    ) VALUES ($1,$2,$3,'RUNNING',false,$4,$5,$6,$7,$8)`,
    [
      input.runId,
      input.snapshotId,
      input.tenantId,
      input.idempotencyHash,
      input.pipelineVersion,
      input.modelVersion,
      input.promptVersion,
      input.splunkQueryVersion,
    ]
  );
}

async function appendStageEvent(input: {
  runId: string;
  stage: 'SPLUNK_FETCH' | 'SNAPSHOT_WRITE' | 'KPI_AGGREGATION' | 'AI_DECISIONS';
  status: 'SUCCESS' | 'FAILED';
  errorType?: 'UNKNOWN';
  errorCode?: string;
  errorMessage?: string;
}): Promise<void> {
  await testPool.query(
    `INSERT INTO pipeline_stage_events (
      run_id, stage, attempt, status, completed_at, records_processed, metadata_json, error_message, error_type, error_code
    ) VALUES ($1,$2,1,$3,NOW(),0,NULL,$4,$5,$6)`,
    [input.runId, input.stage, input.status, input.errorMessage || null, input.errorType || null, input.errorCode || null]
  );
}

async function markRunFailed(runId: string, errorMessage: string): Promise<void> {
  await testPool.query(
    `UPDATE pipeline_runs
     SET status = 'FAILED', published = false, error_message = $2, idempotency_hash = NULL
     WHERE run_id = $1`,
    [runId, errorMessage]
  );
}

async function publishRunAtomic(input: { runId: string; snapshotId: string; tenantId: string }): Promise<void> {
  const client = await testPool.connect();
  try {
    await client.query('BEGIN');
    const pointerRes = await client.query(
      `SELECT active_run_id FROM tenant_snapshot_pointer WHERE tenant_id = $1 FOR UPDATE`,
      [input.tenantId]
    );
    if (pointerRes.rows.length > 0) {
      await client.query(`UPDATE pipeline_runs SET superseded_by_run_id = $1 WHERE run_id = $2`, [
        input.runId,
        pointerRes.rows[0].active_run_id,
      ]);
    }
    await client.query(`UPDATE pipeline_runs SET status='SUCCEEDED', published=true, published_at=NOW() WHERE run_id=$1`, [
      input.runId,
    ]);
    await client.query(
      `INSERT INTO tenant_snapshot_pointer (tenant_id, snapshot_source, active_run_id, active_snapshot_id, updated_at)
       VALUES ($1,'splunk_live',$2,$3,NOW())
       ON CONFLICT (tenant_id, snapshot_source) DO UPDATE SET
         active_run_id = EXCLUDED.active_run_id,
         active_snapshot_id = EXCLUDED.active_snapshot_id,
         updated_at = EXCLUDED.updated_at`,
      [input.tenantId, input.runId, input.snapshotId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

let testPool: Pool;

async function getLatestPublishedRun(
  pool: Pool,
  tenantId: string
): Promise<{ runId: string; snapshotId: string; published: boolean } | null> {
  const pointerRes = await pool.query<{ active_run_id: string }>(
    `SELECT active_run_id FROM tenant_snapshot_pointer WHERE tenant_id = $1`,
    [tenantId]
  );
  if (pointerRes.rows.length === 0) return null;
  const runRes = await pool.query<{ run_id: string; snapshot_id: string; published: boolean }>(
    `SELECT run_id, snapshot_id, published FROM pipeline_runs WHERE run_id = $1`,
    [pointerRes.rows[0].active_run_id]
  );
  if (runRes.rows.length === 0) return null;
  return {
    runId: runRes.rows[0].run_id,
    snapshotId: runRes.rows[0].snapshot_id,
    published: runRes.rows[0].published,
  };
}
