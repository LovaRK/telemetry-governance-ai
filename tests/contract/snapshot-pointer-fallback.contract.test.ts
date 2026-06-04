/**
 * Contract: snapshot pointer fallback behaviour
 *
 * Verifies the three scenarios for getLatestPublishedRun() after migration 204
 * introduced (tenant_id, snapshot_source) as the composite primary key.
 *
 * Scenario A — csv_analytics + splunk_live both present
 *   Expected: returns csv_analytics run (priority source)
 *
 * Scenario B — csv_analytics missing, splunk_live present
 *   Expected: returns splunk_live run (fallback)
 *
 * Scenario C — both missing
 *   Expected: returns null, no exception
 *
 * These three cases are the release gate for the snapshot isolation fix (P0).
 * If any scenario regresses, the "Last writer wins" corruption returns.
 */

import { randomUUID } from 'crypto';
import { query } from '../../core/database/connection';
import { getLatestPublishedRun } from '../../apps/web/lib/pipeline-ledger-service';

describe('Contract: snapshot pointer fallback (migration 204)', () => {
  const tenantId = randomUUID();

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function seedRun(source: 'csv_analytics' | 'splunk_live'): Promise<{
    runId: string;
    snapshotId: string;
  }> {
    const runId = randomUUID();
    const snapshotId = randomUUID();

    // Insert a published pipeline_run
    await query(
      `INSERT INTO pipeline_runs (
         run_id, snapshot_id, tenant_id, status, published, published_at, started_at,
         pipeline_version, model_version, prompt_version, splunk_query_version, model_name,
         source_hash, snapshot_hash, idempotency_hash
       ) VALUES (
         $1, $2, $3, 'SUCCEEDED', TRUE, NOW(), NOW(),
         '2.0', 'csv', '1.0', '1.0', 'test-model',
         $4, $5, $6
       )`,
      [
        runId, snapshotId, tenantId,
        `src-${source}`.padEnd(64, '0').slice(0, 64),
        `snap-${source}`.padEnd(64, '0').slice(0, 64),
        `idem-${source}`.padEnd(64, '0').slice(0, 64),
      ]
    );

    // Write pointer for this source only
    await query(
      `INSERT INTO tenant_snapshot_pointer
         (tenant_id, snapshot_source, active_run_id, active_snapshot_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_id, snapshot_source) DO UPDATE
         SET active_run_id      = EXCLUDED.active_run_id,
             active_snapshot_id = EXCLUDED.active_snapshot_id,
             updated_at         = NOW()`,
      [tenantId, source, runId, snapshotId]
    );

    return { runId, snapshotId };
  }

  // ── Setup / teardown ─────────────────────────────────────────────────────

  beforeAll(async () => {
    await query(
      `INSERT INTO tenants (id, name, slug, is_configured)
       VALUES ($1, 'Pointer Fallback Test Tenant', 'pointer-fallback-test', true)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId]
    );
  }, 15000);

  afterEach(async () => {
    await query(`DELETE FROM tenant_snapshot_pointer WHERE tenant_id = $1`, [tenantId]);
    await query(`DELETE FROM pipeline_runs            WHERE tenant_id = $1`, [tenantId]);
  });

  afterAll(async () => {
    await query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  // ── Scenario A ───────────────────────────────────────────────────────────

  test('Scenario A: csv_analytics + splunk_live both present → returns csv_analytics', async () => {
    const csvRun    = await seedRun('csv_analytics');
    const splunkRun = await seedRun('splunk_live');

    const result = await getLatestPublishedRun(tenantId);

    expect(result).not.toBeNull();
    expect(result!.runId).toBe(csvRun.runId);
    expect(result!.snapshotId).toBe(csvRun.snapshotId);

    // Explicitly confirm it did NOT return splunk_live
    expect(result!.runId).not.toBe(splunkRun.runId);
  });

  // ── Scenario B ───────────────────────────────────────────────────────────

  test('Scenario B: csv_analytics missing, splunk_live present → falls back to splunk_live', async () => {
    const splunkRun = await seedRun('splunk_live');
    // csv_analytics row intentionally not seeded

    const result = await getLatestPublishedRun(tenantId);

    expect(result).not.toBeNull();
    expect(result!.runId).toBe(splunkRun.runId);
    expect(result!.snapshotId).toBe(splunkRun.snapshotId);
  });

  // ── Scenario C ───────────────────────────────────────────────────────────

  test('Scenario C: both missing → returns null, no exception', async () => {
    // No pointer rows for this tenant — afterEach ensures clean state
    const result = await getLatestPublishedRun(tenantId);

    expect(result).toBeNull();
  });

  // ── Source isolation regression ───────────────────────────────────────────

  test('Regression: splunk_live write does not overwrite csv_analytics pointer', async () => {
    const csvRun = await seedRun('csv_analytics');

    // Simulate a Splunk Refresh completing (writes to splunk_live only)
    await seedRun('splunk_live');

    // csv_analytics pointer must be untouched
    const pointer = await query<{ active_run_id: string }>(
      `SELECT active_run_id FROM tenant_snapshot_pointer
       WHERE tenant_id = $1 AND snapshot_source = 'csv_analytics'`,
      [tenantId]
    );

    expect(pointer.rows.length).toBe(1);
    expect(pointer.rows[0].active_run_id).toBe(csvRun.runId);
  });

  test('Regression: csv_analytics write does not overwrite splunk_live pointer', async () => {
    const splunkRun = await seedRun('splunk_live');

    // Simulate a 1stmile ingest completing (writes to csv_analytics only)
    await seedRun('csv_analytics');

    // splunk_live pointer must be untouched
    const pointer = await query<{ active_run_id: string }>(
      `SELECT active_run_id FROM tenant_snapshot_pointer
       WHERE tenant_id = $1 AND snapshot_source = 'splunk_live'`,
      [tenantId]
    );

    expect(pointer.rows.length).toBe(1);
    expect(pointer.rows[0].active_run_id).toBe(splunkRun.runId);
  });
});
