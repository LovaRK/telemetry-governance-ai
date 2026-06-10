import { query } from '../../core/database/connection';
import { loginAndGetToken, authGet } from './_helpers';
import './setup';

const SEEDED_TENANT_ID = process.env.TEST_TENANT_ID || 'a11d19eb-6be3-4f9a-9a78-7c8c5182810e';

describe('Contract: snapshot consistency (Phase 1.2)', () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAndGetToken();
  }, 30000);

  test('cache-status returns snapshotId matching published pointer', async () => {
    const res = await authGet('/api/cache-status', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    const pointer = await query<{ active_snapshot_id: string }>(
      `SELECT active_snapshot_id FROM tenant_snapshot_pointer WHERE tenant_id = $1`,
      [SEEDED_TENANT_ID]
    );
    expect(pointer.rows.length).toBe(1);
    expect(body.data.snapshotId).toBe(pointer.rows[0]?.active_snapshot_id);
  });

  test('published agent_decisions match the published snapshot', async () => {
    const res = await authGet('/api/cache-status', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const cacheSnapshotId = body.data?.snapshotId;

    const matching = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2`,
      [SEEDED_TENANT_ID, cacheSnapshotId]
    );

    // Published snapshot must have at least 1 decision.
    expect(parseInt(matching.rows[0]?.count || '0', 10)).toBeGreaterThan(0);
    // The API must return decisions that match — confirm via returned count.
    expect(body.data.decisionCount).toBeGreaterThan(0);
    expect(body.data.decisionCount).toBe(parseInt(matching.rows[0]?.count || '0', 10));
  });

  test('all telemetry_snapshots match published snapshot', async () => {
    const res = await authGet('/api/cache-status', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const cacheSnapshotId = body.data?.snapshotId;

    const matching = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM telemetry_snapshots
       WHERE tenant_id = $1 AND snapshot_id = $2`,
      [SEEDED_TENANT_ID, cacheSnapshotId]
    );
    expect(parseInt(matching.rows[0]?.count || '0', 10)).toBeGreaterThan(0);
  });

  test('published executive_kpi exists for the snapshot', async () => {
    const res = await authGet('/api/cache-status', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const cacheSnapshotId = body.data?.snapshotId;

    const kpis = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM executive_kpis
       WHERE tenant_id = $1 AND snapshot_id = $2`,
      [SEEDED_TENANT_ID, cacheSnapshotId]
    );
    expect(parseInt(kpis.rows[0]?.count || '0', 10)).toBe(1);
  });

  test('cache-status reflects published state', async () => {
    const res = await authGet('/api/cache-status', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.data.hasEverRefreshed).toBe(true);
    expect(body.data.hasData).toBe(true);
    expect(body.data.hasKpis).toBe(true);
    expect(body.data.snapshotStatus).toBe('READY');
  });
});
