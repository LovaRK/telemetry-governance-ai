import { test, expect } from '@playwright/test';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3002';

async function loginToken(request: any): Promise<string> {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: 'admin@bitso.com', password: 'Admin@12345' },
  });
  expect(r.ok()).toBeTruthy();
  const body = await r.json();
  return body.data.accessToken as string;
}

test('governance widgets load with successful API statuses', async ({ page, request }) => {
  const token = await loginToken(request);

  const targets = [
    '/api/governance/cache-coherence?limit=50',
    '/api/governance/mutation-lifecycle?limit=50',
    '/api/model-health',
  ];

  for (const endpoint of targets) {
    const res = await request.get(`${BASE}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), endpoint).toBe(200);
  }

  await page.addInitScript((t) => localStorage.setItem('access_token', t), token);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Governance/i }).click();
  await page.waitForTimeout(2000);

  const text = await page.locator('main').innerText();
  expect(text).toContain('Live Cache Coherence');
  expect(text).toContain('GOVERNANCE WORKFLOW');
});
