import { loginAndGetToken, authGet, authPost, TEST_TENANT_ID } from '../contract/_helpers';
import '../contract/setup';

const SOAK_COUNT = 10;

interface SoakResult {
  attempt: number;
  status: number;
  durationMs: number;
  errorMessage?: string;
  cacheBefore: any;
  cacheAfter: any;
}

interface CacheStatus {
  hasEverRefreshed: boolean;
  hasData: boolean;
  status: string;
  message: string;
}

async function getCacheStatus(token: string): Promise<CacheStatus> {
  const res = await authGet('/api/cache-status', token);
  const body = await res.json() as { data: CacheStatus };
  return body.data;
}

async function triggerRefresh(token: string): Promise<{ status: number; body: any; durationMs: number }> {
  const start = Date.now();
  const res = await authPost('/api/cache', token, { trigger: 'soak_test' });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, durationMs: Date.now() - start };
}

describe('Pre-Release Soak: 10x Refresh', () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAndGetToken();
  }, 30000);

  test('10 consecutive refresh attempts with cache consistency check', async () => {
    const results: SoakResult[] = [];

    for (let i = 1; i <= SOAK_COUNT; i++) {
      const cacheBefore = await getCacheStatus(token);
      const { status, body, durationMs } = await triggerRefresh(token);
      const cacheAfter = await getCacheStatus(token);

      results.push({
        attempt: i,
        status,
        durationMs,
        errorMessage: body?.error || undefined,
        cacheBefore,
        cacheAfter,
      });

      await new Promise(r => setTimeout(r, 500));
    }

    // Validate cache consistency
    for (const r of results) {
      expect(r.cacheBefore.hasEverRefreshed).toBe(r.cacheAfter.hasEverRefreshed);
      expect(r.cacheBefore.hasData).toBe(r.cacheAfter.hasData);
    }

    // No zombie state
    const zombies = results.filter(r => r.cacheAfter.status === 'refreshing' || r.cacheAfter.status === 'running');
    expect(zombies.length).toBe(0);

    const summary = {
      testName: 'refresh-soak-10x',
      timestamp: new Date().toISOString(),
      total: SOAK_COUNT,
      httpOk: results.filter(r => r.status < 400).length,
      httpErr: results.filter(r => r.status >= 400).length,
      avgDurationMs: Math.round(results.reduce((s, r) => s + r.durationMs, 0) / SOAK_COUNT),
      cacheConsistent: results.every(r =>
        r.cacheBefore.hasEverRefreshed === r.cacheAfter.hasEverRefreshed &&
        r.cacheBefore.hasData === r.cacheAfter.hasData
      ),
      noZombieState: zombies.length === 0,
    };

    console.log('\n=== SOAK SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
  }, 120000);
});
