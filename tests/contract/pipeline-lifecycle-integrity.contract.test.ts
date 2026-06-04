import { randomUUID } from 'crypto';
import { query } from '../../core/database/connection';
import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: pipeline lifecycle integrity', () => {
  const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = randomUUID();

  beforeAll(async () => {
    await query(
      `INSERT INTO tenants (id, name, slug, is_configured)
       VALUES ($1, 'Lifecycle Integrity Tenant', 'lifecycle-integrity-tenant', true)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId]
    );

    await query(`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        run_id UUID PRIMARY KEY,
        snapshot_id UUID NOT NULL UNIQUE,
        tenant_id VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL,
        published BOOLEAN NOT NULL DEFAULT FALSE,
        idempotency_hash VARCHAR(64),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ,
        superseded_by_run_id UUID,
        pipeline_version VARCHAR(32) NOT NULL DEFAULT 'v1',
        model_version VARCHAR(64) NOT NULL DEFAULT 'm1',
        prompt_version VARCHAR(32) NOT NULL DEFAULT 'p1',
        splunk_query_version VARCHAR(32) NOT NULL DEFAULT 'q1',
        error_message TEXT
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS pipeline_stage_events (
        event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL,
        stage VARCHAR(32) NOT NULL,
        attempt INT NOT NULL DEFAULT 1,
        status VARCHAR(20) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        records_processed INT NOT NULL DEFAULT 0,
        metadata_json JSONB,
        error_message TEXT,
        error_type VARCHAR(50),
        error_code VARCHAR(100)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS tenant_snapshot_pointer (
        tenant_id VARCHAR(64) PRIMARY KEY,
        active_run_id UUID NOT NULL,
        active_snapshot_id UUID NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });

  afterEach(async () => {
    await query(`DELETE FROM tenant_snapshot_pointer WHERE tenant_id = $1`, [tenantId]);
    await query(`DELETE FROM pipeline_stage_events WHERE run_id IN (SELECT run_id FROM pipeline_runs WHERE tenant_id = $1)`, [tenantId]);
    await query(`DELETE FROM agent_decisions WHERE tenant_id = $1`, [tenantId]);
    await query(`DELETE FROM executive_kpis WHERE tenant_id = $1`, [tenantId]);
    await query(`DELETE FROM telemetry_snapshots WHERE tenant_id = $1`, [tenantId]);
    await query(`DELETE FROM pipeline_runs WHERE tenant_id = $1`, [tenantId]);
  });

  afterAll(async () => {
    await query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  async function seedSnapshot(runId: string, snapshotId: string): Promise<void> {
    await query(
      `INSERT INTO telemetry_snapshots (
         snapshot_id, tenant_id, snapshot_date, granularity, parent_index, index_name, sourcetype,
         total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year,
         risk_score, classification, confidence, recommendation, evidence, raw_metadata
       ) VALUES (
         $1,$2,NOW(),'sourcetype','main','main','syslog',
         100,1.0,30,50,1,
         50,'KEEP',0.8,'KEEP',
         '[]'::jsonb,'{}'::jsonb
       )`,
      [snapshotId, tenantId]
    );

    await query(
      `INSERT INTO tenant_snapshot_pointer (tenant_id, snapshot_source, active_run_id, active_snapshot_id, updated_at)
       VALUES ($1,'splunk_live',$2,$3,NOW())
       ON CONFLICT (tenant_id, snapshot_source) DO UPDATE
       SET active_run_id = EXCLUDED.active_run_id,
           active_snapshot_id = EXCLUDED.active_snapshot_id,
           updated_at = EXCLUDED.updated_at`,
      [tenantId, runId, snapshotId]
    );
  }

  test('RUNNING with 0 decision rows => PARTIAL/RUNNING', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1')`,
      [runId, snapshotId, tenantId]
    );
    await seedSnapshot(runId, snapshotId);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status)
       VALUES ($1, 'AI_DECISIONS', 'IN_PROGRESS')`,
      [runId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.pipelineStatus).toBe('PARTIAL');
    expect(body.data.llmStatus).toBe('RUNNING');
    expect(body.data.failureCode).toBeNull();
    expect(body.data.runId).toBe(runId);
  });

  test('AI_DECISIONS SUCCESS with decisions => READY/READY', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1')`,
      [runId, snapshotId, tenantId]
    );
    await seedSnapshot(runId, snapshotId);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status)
       VALUES ($1, 'AI_DECISIONS', 'SUCCESS')`,
      [runId]
    );
    await query(
      `INSERT INTO agent_decisions (
         snapshot_id, snapshot_date, tenant_id, run_id, index_name, sourcetype,
         tier, action, recommendation, reasoning
       ) VALUES ($1, CURRENT_DATE, $2, $3, 'main', 'syslog', 'Important', 'OPTIMIZE', 'optimize', 'reasoning')`,
      [snapshotId, tenantId, runId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.pipelineStatus).toBe('READY');
    expect(body.data.llmStatus).toBe('READY');
    expect(body.data.failureCode).toBeNull();
    expect(body.data.runId).toBe(runId);
  });

  test('AI_DECISIONS SUCCESS with 0 decisions => FAILED/MISSING_DECISIONS', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1')`,
      [runId, snapshotId, tenantId]
    );
    await seedSnapshot(runId, snapshotId);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status)
       VALUES ($1, 'AI_DECISIONS', 'SUCCESS')`,
      [runId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.pipelineStatus).toBe('FAILED');
    expect(body.data.llmStatus).toBe('FAILED');
    expect(body.data.failureCode).toBe('MISSING_DECISIONS');
    expect(body.data.runId).toBe(runId);
  });

  test('MISSING_DECISIONS sticks for same runId, new runId can transition READY', async () => {
    const token = await loginAndGetToken();
    const runIdA = randomUUID();
    const snapshotA = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1')`,
      [runIdA, snapshotA, tenantId]
    );
    await seedSnapshot(runIdA, snapshotA);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status, error_type, error_code, error_message)
       VALUES ($1, 'AI_DECISIONS', 'FAILED', 'UNKNOWN', 'MISSING_DECISIONS', 'No decisions persisted for run')`,
      [runIdA]
    );

    const resA = await authGet('/api/cache-status', token, tenantId);
    const bodyA = await resA.json() as any;
    expect(resA.status).toBe(200);
    expect(bodyA.data.pipelineStatus).toBe('FAILED');
    expect(bodyA.data.llmStatus).toBe('FAILED');
    expect(bodyA.data.failureCode).toBe('MISSING_DECISIONS');
    expect(bodyA.data.runId).toBe(runIdA);

    const runIdB = randomUUID();
    const snapshotB = randomUUID();
    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1')`,
      [runIdB, snapshotB, tenantId]
    );
    await seedSnapshot(runIdB, snapshotB);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status)
       VALUES ($1, 'AI_DECISIONS', 'SUCCESS')`,
      [runIdB]
    );
    await query(
      `INSERT INTO agent_decisions (
         snapshot_id, snapshot_date, tenant_id, run_id, index_name, sourcetype,
         tier, action, recommendation, reasoning
       ) VALUES ($1, CURRENT_DATE, $2, $3, 'main', 'syslog', 'Important', 'OPTIMIZE', 'optimize', 'reasoning')`,
      [snapshotB, tenantId, runIdB]
    );

    const resB = await authGet('/api/cache-status', token, tenantId);
    const bodyB = await resB.json() as any;
    expect(resB.status).toBe(200);
    expect(bodyB.data.pipelineStatus).toBe('READY');
    expect(bodyB.data.llmStatus).toBe('READY');
    expect(bodyB.data.failureCode).toBeNull();
    expect(bodyB.data.runId).toBe(runIdB);
  });

  test('RUNNING older than threshold => FAILED/FAILED_TIMEOUT/TIMEOUT', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    // Ensure clean state: delete any leftover data for this tenant
    await query(`DELETE FROM pipeline_stage_events WHERE run_id = $1`, [runId]);
    await query(`DELETE FROM pipeline_runs WHERE run_id = $1`, [runId]);

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version, started_at)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1', NOW() - INTERVAL '10 minutes')`,
      [runId, snapshotId, tenantId]
    );
    await seedSnapshot(runId, snapshotId);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status, started_at)
       VALUES ($1, 'AI_DECISIONS', 'IN_PROGRESS', NOW() - INTERVAL '10 minutes')`,
      [runId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.pipelineStatus).toBe('FAILED');
    expect(body.data.llmStatus).toBe('FAILED_TIMEOUT');
    expect(body.data.failureCode).toBe('TIMEOUT');
    expect(body.data.runId).toBe(runId);
  });

  test('FAILED_TIMEOUT sticks for same runId, new runId can transition out', async () => {
    const token = await loginAndGetToken();
    const runIdA = randomUUID();
    const snapshotA = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version, started_at)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1', NOW() - INTERVAL '10 minutes')`,
      [runIdA, snapshotA, tenantId]
    );
    await seedSnapshot(runIdA, snapshotA);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status, error_type, error_code, error_message, started_at)
       VALUES ($1, 'AI_DECISIONS', 'FAILED', 'TIMEOUT', 'TIMEOUT', 'Pipeline idle timeout exceeded', NOW() - INTERVAL '10 minutes')`,
      [runIdA]
    );

    const resA = await authGet('/api/cache-status', token, tenantId);
    const bodyA = await resA.json() as any;
    expect(resA.status).toBe(200);
    expect(bodyA.data.pipelineStatus).toBe('FAILED');
    expect(bodyA.data.llmStatus).toBe('FAILED_TIMEOUT');
    expect(bodyA.data.failureCode).toBe('TIMEOUT');
    expect(bodyA.data.runId).toBe(runIdA);

    const runIdB = randomUUID();
    const snapshotB = randomUUID();
    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1')`,
      [runIdB, snapshotB, tenantId]
    );
    await seedSnapshot(runIdB, snapshotB);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status)
       VALUES ($1, 'AI_DECISIONS', 'IN_PROGRESS')`,
      [runIdB]
    );

    const resB = await authGet('/api/cache-status', token, tenantId);
    const bodyB = await resB.json() as any;
    expect(resB.status).toBe(200);
    expect(bodyB.data.pipelineStatus).toBe('PARTIAL');
    expect(bodyB.data.llmStatus).toBe('RUNNING');
    expect(bodyB.data.failureCode).toBeNull();
    expect(bodyB.data.runId).toBe(runIdB);
  });

  test('FAILED run without explicit error code normalizes failureCode to RUNTIME', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'FAILED',false,'v1','m1','p1','q1')`,
      [runId, snapshotId, tenantId]
    );
    await seedSnapshot(runId, snapshotId);
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status, error_message)
       VALUES ($1, 'SPLUNK_FETCH', 'FAILED', 'Cannot connect to Splunk')`,
      [runId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.pipelineStatus).toBe('FAILED');
    expect(body.data.llmStatus).toBe('FAILED');
    expect(body.data.failureCode).toBe('RUNTIME');
    expect(String(body.data.failureReason || '')).toContain('Splunk');
    expect(body.data.runId).toBe(runId);
  });
});
