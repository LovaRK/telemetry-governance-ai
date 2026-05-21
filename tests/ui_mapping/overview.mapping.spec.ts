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

test('overview KPI cards map to executive-summary API values', async ({ page, request }) => {
  const token = await loginToken(request);

  const apiRes = await request.get(`${BASE}/api/executive-summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(apiRes.ok()).toBeTruthy();
  const apiBody = await apiRes.json();
  const kpis = apiBody.data.kpis;

  await page.addInitScript((t) => localStorage.setItem('access_token', t), token);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const bodyText = await page.locator('main').innerText();
  expect(bodyText).toContain('EXECUTIVE OVERVIEW');
  expect(bodyText).toContain(`${kpis.totalSourcetypes} indexes`);

  const expectedGb = Number(kpis.totalDailyGb);
  if (expectedGb > 0) {
    expect(bodyText).toMatch(/Daily Ingest|DAILY INGEST/i);
  }
});
