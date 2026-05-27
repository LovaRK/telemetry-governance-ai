import { query } from '../../core/database/connection';
import { authGet, loginAndGetToken } from './_helpers';
import { createHash } from 'node:crypto';

function uuidV5From(ns: string, name: string): string {
  const hash = createHash('md5').update(`${ns}:${name}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

describe('Contract: job lease timeout ownership', () => {
  const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = uuidV5From('lease-timeout', `a-${testId}`);
  const otherTenantId = uuidV5From('lease-timeout', `b-${testId}`);
  let token: string;

  beforeAll(async () => {
    token = await loginAndGetToken();
    await query(
      `INSERT INTO tenants (id, name, slug, is_configured)
       VALUES ($1, $2, $3, true), ($4, $5, $6, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        tenantId,
        `Lease Timeout Tenant A ${testId}`,
        `lease-timeout-a-${testId}`,
        otherTenantId,
        `Lease Timeout Tenant B ${testId}`,
        `lease-timeout-b-${testId}`,
      ]
    );
  });

  afterEach(async () => {
    await query(
      `DELETE FROM pipeline_stage_events
       WHERE run_id IN (
         SELECT run_id FROM pipeline_runs WHERE tenant_id IN ($1, $2)
       )`,
      [tenantId, otherTenantId]
    );
    await query(`DELETE FROM pipeline_runs WHERE tenant_id IN ($1, $2)`, [tenantId, otherTenantId]);
    await query(
      `DELETE FROM job_queue
       WHERE payload->>'tenantId' IN ($1, $2)`,
      [tenantId, otherTenantId]
    );
  });

  test('expired running lease is normalized to FAILED/TIMEOUT on status read', async () => {
    const runId = '11111111-1111-4111-8111-111111111131';
    const snapshotId = '22222222-2222-4222-8222-222222222232';

    await query(
      `INSERT INTO pipeline_runs (
         run_id, snapshot_id, tenant_id, status, published,
         pipeline_version, model_version, prompt_version, splunk_query_version, started_at
       )
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1', NOW() - INTERVAL '10 minutes')`,
      [runId, snapshotId, tenantId]
    );
    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status, started_at)
       VALUES ($1,'AI_DECISIONS','IN_PROGRESS', NOW() - INTERVAL '10 minutes')`,
      [runId]
    );
    await query(
      `INSERT INTO job_queue (job_type, snapshot_id, payload, status, progress, snapshot_date, started_at, heartbeat_at, lease_expires_at)
       VALUES ('llm_analysis', $1, $2::jsonb, 'running', '{"batch":0,"totalBatches":1,"decisionsWritten":0}', CURRENT_DATE, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '1 minute')`,
      [snapshotId, JSON.stringify({ runId, tenantId, userId: 'u', traceId: 't', snapshotId })]
    );

    const res = await authGet('/api/cache-status', token, tenantId, 'lease-timeout-user');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.pipelineStatus).toBe('FAILED');
    expect(['FAILED', 'FAILED_TIMEOUT']).toContain(body.data.llmStatus);
    expect(['TIMEOUT', 'RUNTIME']).toContain(body.data.failureCode);
  });

  test('status read for tenant A does not recover stale jobs for tenant B', async () => {
    const runA = '31111111-1111-4111-8111-111111111131';
    const snapA = '32222222-2222-4222-8222-222222222232';
    const runB = '41111111-1111-4111-8111-111111111131';
    const snapB = '42222222-2222-4222-8222-222222222232';

    await query(
      `INSERT INTO pipeline_runs (
         run_id, snapshot_id, tenant_id, status, published,
         pipeline_version, model_version, prompt_version, splunk_query_version, started_at
       )
       VALUES
       ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1', NOW() - INTERVAL '10 minutes'),
       ($4,$5,$6,'RUNNING',true,'v1','m1','p1','q1', NOW() - INTERVAL '10 minutes')`,
      [runA, snapA, tenantId, runB, snapB, otherTenantId]
    );

    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status, started_at)
       VALUES
       ($1,'AI_DECISIONS','IN_PROGRESS', NOW() - INTERVAL '10 minutes'),
       ($2,'AI_DECISIONS','IN_PROGRESS', NOW() - INTERVAL '10 minutes')`,
      [runA, runB]
    );

    await query(
      `INSERT INTO job_queue (job_type, snapshot_id, payload, status, progress, snapshot_date, started_at, heartbeat_at, lease_expires_at)
       VALUES
       ('llm_analysis', $1, $2::jsonb, 'running', '{"batch":0,"totalBatches":1,"decisionsWritten":0}', CURRENT_DATE, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '1 minute'),
       ('llm_analysis', $3, $4::jsonb, 'running', '{"batch":0,"totalBatches":1,"decisionsWritten":0}', CURRENT_DATE, NOW(), NOW(), NOW() + INTERVAL '10 minutes')`,
      [
        snapA,
        JSON.stringify({ runId: runA, tenantId, userId: 'u-a', traceId: 't-a', snapshotId: snapA }),
        snapB,
        JSON.stringify({ runId: runB, tenantId: otherTenantId, userId: 'u-b', traceId: 't-b', snapshotId: snapB }),
      ]
    );

    const res = await authGet('/api/cache-status', token, tenantId, 'tenant-a-user');
    expect(res.status).toBe(200);

    const runAStatus = await query<{ status: string }>(`SELECT status FROM pipeline_runs WHERE run_id = $1`, [runA]);
    const runBStatus = await query<{ status: string }>(`SELECT status FROM pipeline_runs WHERE run_id = $1`, [runB]);
    expect(runAStatus.rows[0]?.status).toBe('FAILED');
    expect(runBStatus.rows[0]?.status).toBe('RUNNING');

    const jobA = await query<{ status: string }>(
      `SELECT status FROM job_queue WHERE payload->>'runId' = $1`,
      [runA]
    );
    const jobB = await query<{ status: string }>(
      `SELECT status FROM job_queue WHERE payload->>'runId' = $1`,
      [runB]
    );
    expect(jobA.rows[0]?.status).toBe('failed');
    expect(jobB.rows[0]?.status).toBe('running');
  });

  test('tenant B stale timeout is recovered only when tenant B queries cache-status', async () => {
    const runB = '51111111-1111-4111-8111-111111111131';
    const snapB = '52222222-2222-4222-8222-222222222232';

    await query(
      `INSERT INTO pipeline_runs (
         run_id, snapshot_id, tenant_id, status, published,
         pipeline_version, model_version, prompt_version, splunk_query_version, started_at
       )
       VALUES ($1,$2,$3,'RUNNING',true,'v1','m1','p1','q1', NOW() - INTERVAL '10 minutes')`,
      [runB, snapB, otherTenantId]
    );

    await query(
      `INSERT INTO pipeline_stage_events (run_id, stage, status, started_at)
       VALUES ($1,'AI_DECISIONS','IN_PROGRESS', NOW())`,
      [runB]
    );

    await query(
      `INSERT INTO job_queue (job_type, snapshot_id, payload, status, progress, snapshot_date, started_at, heartbeat_at, lease_expires_at)
       VALUES ('llm_analysis', $1, $2::jsonb, 'running', '{"batch":0,"totalBatches":1,"decisionsWritten":0}', CURRENT_DATE, NOW(), NOW(), NOW() + INTERVAL '10 minutes')`,
      [snapB, JSON.stringify({ runId: runB, tenantId: otherTenantId, userId: 'u-b', traceId: 't-b', snapshotId: snapB })]
    );

    const resTenantA = await authGet('/api/cache-status', token, tenantId, 'tenant-a-user');
    expect(resTenantA.status).toBe(200);

    const before = await query<{ status: string }>(`SELECT status FROM pipeline_runs WHERE run_id = $1`, [runB]);
    expect(before.rows[0]?.status).toBe('RUNNING');

    // Make tenant B stale only now so this test controls when recovery can occur.
    await query(
      `UPDATE job_queue
       SET started_at = NOW() - INTERVAL '10 minutes',
           heartbeat_at = NOW() - INTERVAL '10 minutes',
           lease_expires_at = NOW() - INTERVAL '1 minute'
       WHERE payload->>'runId' = $1`,
      [runB]
    );
    await query(
      `UPDATE pipeline_stage_events
       SET started_at = NOW() - INTERVAL '10 minutes'
       WHERE run_id = $1 AND stage = 'AI_DECISIONS'`,
      [runB]
    );

    const resTenantB = await authGet('/api/cache-status', token, otherTenantId, 'tenant-b-user');
    expect(resTenantB.status).toBe(200);

    const after = await query<{ status: string }>(`SELECT status FROM pipeline_runs WHERE run_id = $1`, [runB]);
    expect(after.rows[0]?.status).toBe('FAILED');
  });
});
