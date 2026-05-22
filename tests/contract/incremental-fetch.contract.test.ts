import { query } from '../../core/database/connection';
import { fetchChangedSources } from '../../apps/api/services/incremental-fetch-service';

describe('Contract: incremental fetch service', () => {
  const cleanupIds: string[] = [];
  const cleanupTenants: string[] = [];

  beforeAll(async () => {
    await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  });

  afterEach(async () => {
    if (cleanupIds.length > 0) {
      await query('DELETE FROM telemetry_snapshots WHERE snapshot_id = ANY($1::uuid[])', [cleanupIds]);
      cleanupIds.length = 0;
    }
    if (cleanupTenants.length > 0) {
      await query('DELETE FROM telemetry_snapshots WHERE tenant_id::text = ANY($1::varchar[])', [cleanupTenants]);
      cleanupTenants.length = 0;
    }
  });

  test('watermark NULL returns full fetch from latest snapshot', async () => {
    const tenantId = await mkTenant();
    await seedSnapshot(tenantId, ['main', 'history']);
    const s2 = await seedSnapshot(tenantId, ['main', 'history', 'tutorial']);

    const out = await fetchChangedSources({ tenantId, since: null });

    expect(out.deleted).toHaveLength(0);
    expect(out.unchanged).toHaveLength(0);
    expect(out.changed.length).toBeGreaterThanOrEqual(3);
    expect(new Set(out.changed.map((r) => r.snapshotId))).toEqual(new Set([s2]));
  });

  test('recent watermark returns changed only', async () => {
    const tenantId = await mkTenant();
    await seedSnapshot(tenantId, ['main', 'history']);
    const latest = await seedSnapshot(tenantId, ['main', 'history']);
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    await insertRow(latest, 'tutorial', tenantId);
    const out = await fetchChangedSources({ tenantId, since });

    expect(out.changed.map((r) => r.indexName)).toContain('tutorial');
    expect(out.changed.map((r) => r.indexName)).not.toContain('main');
    expect(out.changed.map((r) => r.indexName)).not.toContain('history');
  });

  test('no changes returns empty delta', async () => {
    const tenantId = await mkTenant();
    await seedSnapshot(tenantId, ['main', 'history']);
    await seedSnapshot(tenantId, ['main', 'history']);

    const since = new Date(Date.now() + 60 * 1000).toISOString();
    const out = await fetchChangedSources({ tenantId, since });

    expect(out.changed).toHaveLength(0);
  });

  async function mkTenant(): Promise<string> {
    const tenantRes = await query('SELECT gen_random_uuid()::text as id');
    const tenantId = tenantRes.rows[0].id as string;
    cleanupTenants.push(tenantId);
    return tenantId;
  }

  async function seedSnapshot(tenantId: string, indexes: string[]): Promise<string> {
    const idRes = await query('SELECT gen_random_uuid() as id');
    const snapshotId = idRes.rows[0].id as string;
    cleanupIds.push(snapshotId);

    for (const idx of indexes) {
      await insertRow(snapshotId, idx, tenantId);
    }

    return snapshotId;
  }

  async function insertRow(snapshotId: string, idx: string, tenantId: string): Promise<void> {
    await query(
      `INSERT INTO telemetry_snapshots (
        snapshot_id, snapshot_date, granularity, index_name, sourcetype,
        total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year,
        risk_score, classification, confidence, recommendation, evidence, raw_metadata,
        tenant_id
      ) VALUES (
        $1::uuid, CURRENT_DATE, 'index', $2, NULL,
        1000, 1.5, 90, 50, 100,
        40, 'KEEP', 0.9, 'test', '[]'::jsonb, '{}'::jsonb,
        $3
      )`,
      [snapshotId, idx, tenantId]
    );
  }
});
