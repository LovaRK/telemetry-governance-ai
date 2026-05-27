import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

async function loginAndGetToken() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@bitso.com', password: 'Admin@12345' }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const body = await res.json();
  const token = body?.data?.accessToken;
  if (!token) throw new Error('Missing access token');
  return token;
}

async function authPost(path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
      'x-user-id': 'test-user',
      'x-user-role': 'admin',
    },
    body: JSON.stringify(body),
  });
  let responseBody = null;
  try { responseBody = await res.json(); } catch (e) { responseBody = { parseError: e.message }; }
  return { status: res.status, body: responseBody };
}

async function authGet(path, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
      'x-user-id': 'test-user',
      'x-user-role': 'admin',
    },
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function runSoak() {
  console.log('=== Refresh Soak Test (10x) ===\n');
  const token = await loginAndGetToken();
  console.log('✓ Logged in\n');

  const results = [];

  for (let i = 1; i <= 10; i++) {
    const started = Date.now();
    let cacheBefore, cacheAfter, response;

    try {
      cacheBefore = await authGet('/api/cache-status', token);
      response = await authPost('/api/cache', token, {
        mcpUrl: 'http://localhost:8089',
        username: 'admin',
        password: 'teja@123',
        trigger: `refresh_soak_${i}`,
        lookbackDays: 1,
      });
    } catch (e) {
      console.error(`[${i}/10] FATAL: ${e.message}`);
      results.push({ attempt: i, durationMs: Date.now() - started, error: e.message });
      continue;
    }

    const durationMs = Date.now() - started;
    try { cacheAfter = await authGet('/api/cache-status', token); } catch (e) { /* ignore */ }

    const entry = {
      attempt: i,
      durationMs,
      responseStatus: response.status,
      responseBody: response.body,
      cacheBefore: cacheBefore ? cacheBefore.body : null,
      cacheAfter: cacheAfter ? cacheAfter.body : null,
    };
    results.push(entry);

    const phase = response.body?.phase || 'rejected';
    const httpOk = response.status < 500 ? 'OK' : 'ERR';
    console.log(`[${i}/10] HTTP ${response.status} phase=${phase} duration=${durationMs}ms`);

    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const ok = results.filter(r => r.responseStatus < 500).length;
  const err = results.filter(r => r.responseStatus >= 500).length;
  const avgDuration = Math.round(results.reduce((a, r) => a + r.durationMs, 0) / results.length);
  console.log(`\n=== Summary ===`);
  console.log(`HTTP OK: ${ok}, HTTP ERR: ${err}, Avg: ${avgDuration}ms`);

  // Semantic validation
  const semantics = {
    errorResponseStructure: results.filter(r => r.responseStatus >= 500).map(r => ({
      attempt: r.attempt,
      hasError: !!r.responseBody?.error,
      hasMeta: !!r.responseBody?.meta,
      errorMessage: r.responseBody?.error,
    })),
    cacheConsistency: results.map(r => ({
      attempt: r.attempt,
      beforeHasEverRefreshed: r.cacheBefore?.data?.hasEverRefreshed,
      afterHasEverRefreshed: r.cacheAfter?.data?.hasEverRefreshed,
      consistent: r.cacheBefore?.data?.hasEverRefreshed === r.cacheAfter?.data?.hasEverRefreshed,
    })),
    noZombieState: results.every(r =>
      r.cacheAfter?.data?.status !== 'refreshing' &&
      !r.cacheAfter?.data?.message?.includes('refreshing')
    ),
  };

  console.log(`\n=== Semantic Validation ===`);
  console.log(`Error responses with proper structure: ${semantics.errorResponseStructure.filter(e => e.hasError && e.hasMeta).length}/${semantics.errorResponseStructure.length}`);
  console.log(`Cache consistent across failures: ${semantics.cacheConsistency.filter(c => c.consistent).length}/${semantics.cacheConsistency.length}`);
  console.log(`No zombie refreshing state: ${semantics.noZombieState ? 'PASS' : 'FAIL'}`);

  // Verify the error response has the expected properties
  if (semantics.errorResponseStructure.length > 0) {
    const sample = semantics.errorResponseStructure[0];
    console.log(`\nSample error structure: error="${sample.errorMessage}", hasMeta=${sample.hasMeta}`);
  }

  // Check no stale PENDING/RUNNING records left behind
  semantics.cacheConsistency.forEach(c => {
    if (!c.consistent) console.log(`  ⚠ Cache state changed on attempt ${c.attempt}: ${c.beforeHasEverRefreshed} -> ${c.afterHasEverRefreshed}`);
  });

  writeFileSync(join(__dirname, 'refresh-soak-10x.json'), JSON.stringify({
    testName: 'refresh-soak-10x',
    timestamp: new Date().toISOString(),
    description: '10 consecutive pipeline refresh attempts to validate lifecycle semantics (Splunk unavailable)',
    summary: { total: 10, httpOk: ok, httpErr: err, avgDurationMs: avgDuration },
    semanticValidation: semantics,
    results,
  }, null, 2));
  console.log('\n✓ Results saved');
}

runSoak().catch(e => { console.error('FATAL:', e); process.exit(1); });
