import { randomUUID } from 'crypto';
import { query } from '../../core/database/connection';
import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: /api/cache-status canonical lifecycle', () => {
  const tenantId = '550e8400-e29b-41d4-a716-446655449901';

  beforeAll(async () => {
    await query(
      `INSERT INTO tenants (id, name, slug, is_configured)
       VALUES ($1, 'Cache Status Lifecycle Tenant', 'cache-status-lifecycle-tenant', true)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId]
    );

    // Ensure ledger schema exists
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
        error_message TEXT
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
    await query(`DELETE FROM pipeline_runs WHERE tenant_id = $1`, [tenantId]);
    await query(`DELETE FROM executive_kpis WHERE tenant_id = $1`, [tenantId]);
    await query(`DELETE FROM telemetry_snapshots WHERE tenant_id = $1`, [tenantId]);
  });

  afterAll(async () => {
    await query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  test('snapshot READY + llm RUNNING => pipeline PARTIAL', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1')`,
      [runId, snapshotId, tenantId]
    );
    await query(
      `INSERT INTO telemetry_snapshots (
         snapshot_id, tenant_id, snapshot_date, granularity, parent_index, index_name, sourcetype,
         total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year,
         risk_score, classification, confidence, recommendation, evidence, raw_metadata
       )
       VALUES (
         $1,$2,NOW(),'sourcetype','main','main','syslog',
         100,1,30,50,1,
         50,'KEEP',0.8,'KEEP',
         '[]'::jsonb,'{}'::jsonb
       )`,
      [snapshotId, tenantId]
    );
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status)
       VALUES ($1,'AI_DECISIONS','IN_PROGRESS')`,
      [runId]
    );
    await query(
      `INSERT INTO tenant_snapshot_pointer (tenant_id, active_run_id, active_snapshot_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET active_run_id = EXCLUDED.active_run_id,
           active_snapshot_id = EXCLUDED.active_snapshot_id,
           updated_at = EXCLUDED.updated_at`,
      [tenantId, runId, snapshotId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.snapshotStatus).toBe('READY');
    expect(body.data.llmStatus).toBe('RUNNING');
    expect(body.data.pipelineStatus).toBe('PARTIAL');
  });

  test('snapshot READY + llm READY => pipeline READY', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'SUCCEEDED',true,'v1','m1','p1','q1')`,
      [runId, snapshotId, tenantId]
    );
    await query(
      `INSERT INTO telemetry_snapshots (
         snapshot_id, tenant_id, snapshot_date, granularity, parent_index, index_name, sourcetype,
         total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year,
         risk_score, classification, confidence, recommendation, evidence, raw_metadata
       )
       VALUES (
         $1,$2,NOW(),'sourcetype','main','main','syslog',
         100,1,30,50,1,
         50,'KEEP',0.8,'KEEP',
         '[]'::jsonb,'{}'::jsonb
       )`,
      [snapshotId, tenantId]
    );
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status)
       VALUES ($1,'AI_DECISIONS','SUCCESS')`,
      [runId]
    );
    await query(
      `INSERT INTO agent_decisions (
         snapshot_id, snapshot_date, tenant_id, run_id, index_name, sourcetype,
         tier, action, recommendation, reasoning
       ) VALUES ($1, CURRENT_DATE, $2, $3, 'main', 'syslog', 'Important', 'OPTIMIZE', 'optimize', 'reasoning')`,
      [snapshotId, tenantId, runId]
    );
    await query(
      `INSERT INTO tenant_snapshot_pointer (tenant_id, active_run_id, active_snapshot_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET active_run_id = EXCLUDED.active_run_id,
           active_snapshot_id = EXCLUDED.active_snapshot_id,
           updated_at = EXCLUDED.updated_at`,
      [tenantId, runId, snapshotId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.snapshotStatus).toBe('READY');
    expect(body.data.llmStatus).toBe('READY');
    expect(body.data.pipelineStatus).toBe('READY');
  });

  test('snapshot FAILED => pipeline FAILED', async () => {
    const token = await loginAndGetToken();
    const runId = randomUUID();
    const snapshotId = randomUUID();

    await query(
      `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, pipeline_version, model_version, prompt_version, splunk_query_version)
       VALUES ($1,$2,$3,'FAILED',false,'v1','m1','p1','q1')`,
      [runId, snapshotId, tenantId]
    );
    await query(
      `INSERT INTO tenant_snapshot_pointer (tenant_id, active_run_id, active_snapshot_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET active_run_id = EXCLUDED.active_run_id,
           active_snapshot_id = EXCLUDED.active_snapshot_id,
           updated_at = EXCLUDED.updated_at`,
      [tenantId, runId, snapshotId]
    );

    const res = await authGet('/api/cache-status', token, tenantId);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.snapshotStatus).toBe('FAILED');
    expect(body.data.pipelineStatus).toBe('FAILED');
  });
});
