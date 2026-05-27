/* eslint-disable no-console */
import fs from 'fs/promises';
import path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const EMAIL = process.env.DASH_EMAIL || 'admin@bitso.com';
const PASSWORD = process.env.DASH_PASSWORD || 'Admin@12345';
const TENANT_ID = process.env.DASH_TENANT_ID || '550e8400-e29b-41d4-a716-446655440000';

const OUT_DIR = path.join(process.cwd(), 'tests/fixtures/live-dashboard');

async function jsonFetch(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, ok: res.ok, body };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'x-tenant-id': TENANT_ID,
    'x-user-id': 'parity-check',
    'x-user-role': 'admin',
    'content-type': 'application/json',
  };
}

async function ensureDir() {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

async function save(name: string, data: unknown) {
  await fs.writeFile(path.join(OUT_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function assertContracts(cacheStatus: any) {
  const errors: string[] = [];
  const data = cacheStatus?.data || {};

  if (data.publishedAt && data.decisionCount > 0 && !data.decisionHash) {
    errors.push('Contract violation: decisionCount > 0 but decisionHash is null');
  }

  if (data.pipelineStatus === 'READY' && data.llmStatus !== 'READY') {
    errors.push('Contract violation: pipelineStatus READY requires llmStatus READY');
  }

  if (data.pipelineStatus === 'PARTIAL' && data.snapshotStatus !== 'READY') {
    errors.push('Contract violation: pipelineStatus PARTIAL requires snapshotStatus READY');
  }

  return errors;
}

async function main() {
  await ensureDir();

  const login = await jsonFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  await save('auth-login', login);

  if (!login.ok || !login.body?.data?.accessToken) {
    throw new Error(`Login failed (${login.status}). Check DASH_EMAIL/DASH_PASSWORD.`);
  }

  const token = login.body.data.accessToken as string;

  const endpoints = [
    '/api/cache-status',
    '/api/executive-summary',
    '/api/decision-history',
    '/api/telemetry-value',
    '/api/model-health',
  ];

  const captures: Record<string, any> = {};
  for (const ep of endpoints) {
    const r = await jsonFetch(`${BASE_URL}${ep}`, { headers: headers(token) as any });
    captures[ep] = r;
    await save(ep.replace(/\//g, '_').replace(/^_/, ''), r);
  }

  const cacheStatus = captures['/api/cache-status'];
  const violations = assertContracts(cacheStatus.body);
  const report = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    tenantId: TENANT_ID,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    notes: [
      'This script validates API-level contracts and snapshot/run consistency anchors.',
      'UI parity checks should consume these fixtures in Playwright assertions.',
    ],
  };

  await save('parity-report', report);

  console.log(`Saved fixtures to: ${OUT_DIR}`);
  if (violations.length > 0) {
    console.error('Parity violations found:');
    for (const v of violations) console.error(` - ${v}`);
    process.exit(1);
  }

  console.log('Parity contract checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
