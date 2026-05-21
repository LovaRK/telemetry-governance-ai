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

test('telemetry table count reflects executive-summary snapshots length', async ({ page, request }) => {
  const token = await loginToken(request);

  const apiRes = await request.get(`${BASE}/api/executive-summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const apiBody = await apiRes.json();
  const snapshotCount = (apiBody.data.snapshots || []).length;

  await page.addInitScript((t) => localStorage.setItem('access_token', t), token);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Telemetry Detail/i }).click();
  await page.waitForTimeout(1500);

  const text = await page.locator('main').innerText();
  expect(text).toContain(`TELEMETRY INTELLIGENCE — ${snapshotCount} INDEXES`);
});
