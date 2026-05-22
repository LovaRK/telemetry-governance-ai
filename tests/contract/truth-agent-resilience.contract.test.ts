import { authPost, loginAndGetToken } from './_helpers';
import { query } from '../../core/database/connection';

describe('Contract: truth-agent resilience (non-blocking guarantees)', () => {
  test('truth-agent errors do not block /api/cache response path', async () => {
    const token = await loginAndGetToken();

    const started = Date.now();
    const res = await authPost('/api/cache', token, {
      mcpUrl: 'http://localhost:8089',
      username: 'bad-user',
      password: 'bad-pass',
      trigger: 'truth_agent_failure_isolation',
      lookbackDays: 1,
    });
    const elapsedMs = Date.now() - started;

    expect([200, 500]).toContain(res.status);
    expect(elapsedMs).toBeLessThan(30000);
  });

  test('truth-agent long execution cannot stall refresh endpoint', async () => {
    const token = await loginAndGetToken();

    const started = Date.now();
    const res = await authPost('/api/cache', token, {
      mcpUrl: 'http://localhost:8089',
      username: 'bad-user',
      password: 'bad-pass',
      trigger: 'truth_agent_latency_isolation',
      lookbackDays: 1,
    });
    const elapsedMs = Date.now() - started;

    expect([200, 500]).toContain(res.status);
    expect(elapsedMs).toBeLessThan(30000);
  });

  test('concurrent refresh attempts do not create lock contention on truth tables', async () => {
    const token = await loginAndGetToken();

    await Promise.all([
      authPost('/api/cache', token, { mcpUrl: 'http://localhost:8089', username: 'bad-user', password: 'bad-pass', trigger: 'truth_agent_multi_1', lookbackDays: 1 }),
      authPost('/api/cache', token, { mcpUrl: 'http://localhost:8089', username: 'bad-user', password: 'bad-pass', trigger: 'truth_agent_multi_2', lookbackDays: 1 }),
      authPost('/api/cache', token, { mcpUrl: 'http://localhost:8089', username: 'bad-user', password: 'bad-pass', trigger: 'truth_agent_multi_3', lookbackDays: 1 }),
    ]);

    const lockRes = await query(
      `SELECT COUNT(*)::int AS blocked
       FROM pg_locks bl
       JOIN pg_class c ON c.oid = bl.relation
       WHERE c.relname IN ('dashboard_truth_runs', 'dashboard_truth_failures')
         AND NOT bl.granted`
    );

    expect(Number(lockRes.rows[0]?.blocked || 0)).toBe(0);

    const runRes = await query(`SELECT status FROM dashboard_truth_runs ORDER BY started_at DESC LIMIT 5`);
    runRes.rows.forEach((r: any) => {
      expect(['PASS', 'WARN', 'BLOCK']).toContain(r.status);
    });
  }, 20000);
});
