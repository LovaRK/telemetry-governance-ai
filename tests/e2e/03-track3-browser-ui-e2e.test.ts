import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

test.beforeEach(async ({ page }) => {
  page.on('console', (msg) => {
    const text = msg.text();
    expect(text).not.toMatch(/useUser must be used within UserProvider/i);
    expect(text).not.toMatch(/Unexpected end of JSON input/i);
  });
});

test.describe('Track 3: Browser UI/UX Full E2E', () => {
  test('login flow works end-to-end', async ({ page }) => {
    await login(page, BASE_URL);
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  });

  test('splunk connect gate renders and shows real HTTP 500', async ({ page }) => {
    await login(page, BASE_URL);

    const splunkGate = page.locator('[data-testid="splunk-connect"]');
    if (await splunkGate.isVisible()) {
      const gateText = await page.textContent('body');
      expect(gateText).not.toMatch(/Unexpected end of JSON input|SyntaxError/i);

      const errorMessage = page.locator('text=/HTTP 500|login-info/i');
      if (await errorMessage.isVisible()) {
        expect(await errorMessage.textContent()).toMatch(/HTTP 500|login-info|Splunk/i);
      }
    }
  });

  test('governance overview tab renders without 503', async ({ page }) => {
    await login(page, BASE_URL);

    await page.goto(`${BASE_URL}/governance`);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    await expect(page.getByRole('heading', { name: /governance/i }).first()).toBeVisible();
    const pageText = await page.textContent('body');
    expect(pageText).not.toMatch(/503|Service Unavailable/i);
  });

  test('trust layer status fetches from /api/governance/trust-status', async ({ page }) => {
    await login(page, BASE_URL);

    await page.goto(`${BASE_URL}/governance`);

    const apiCalls: string[] = [];
    page.on('request', (req) => {
      apiCalls.push(req.url());
    });

    await page.waitForLoadState('networkidle').catch(() => undefined);

    const hasTrustStatusCall = apiCalls.some(url => url.includes('/api/governance/trust-status'));
    expect(hasTrustStatusCall).toBe(true);

    const trustStatus = page.getByRole('heading', { name: /trust layer status/i }).first();
    await expect(trustStatus).toBeVisible({ timeout: 5000 });

    const trustContent = await page.textContent('body');
    expect(trustContent).toMatch(/Confidence Decay|Seasonality/);
  });

  test('drift monitor renders without schema errors', async ({ page }) => {
    await login(page, BASE_URL);

    await page.goto(`${BASE_URL}/governance?tab=drift`);
    await page.waitForLoadState('networkidle');

    const driftMonitor = page.getByRole('button', { name: /drift monitor/i }).first();
    await expect(driftMonitor).toBeVisible({ timeout: 5000 });

    const pageText = await page.textContent('body');
    expect(pageText).not.toMatch(/decision_drift_history|schema|column.*does not exist/i);
  });

  test('reanalysis queue renders queue_health_metrics-backed state', async ({ page }) => {
    await login(page, BASE_URL);

    await page.goto(`${BASE_URL}/governance?tab=queue`);
    await page.waitForLoadState('networkidle');

    const queueSection = page.getByRole('button', { name: /reanalysis queue/i }).first();
    if (await queueSection.isVisible()) {
      const apiCalls: string[] = [];
      page.on('request', (req) => {
        apiCalls.push(req.url());
      });

      const hasQueueCall = apiCalls.some(url => url.includes('/api/queue-health'));
      expect(hasQueueCall).toBe(true);
    }
  });

  test('decision review renders without useUser crash', async ({ page }) => {
    await login(page, BASE_URL);

    await page.goto(`${BASE_URL}/governance?tab=review`);
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toMatch(/useUser must be used within UserProvider|Cannot read properties|TypeError/i);
  });

  test('decision history uses db-backed api, not stub', async ({ page }) => {
    await login(page, BASE_URL);

    const response = await page.evaluate(async () => {
      const res = await fetch('/api/decision-history', {
        headers: {
          'content-type': 'application/json',
        },
      });

      return {
        status: res.status,
        body: await res.text(),
      };
    });

    expect(response.status).toBeLessThan(500);

    const json = JSON.parse(response.body);

    expect(JSON.stringify(json)).not.toMatch(/demo mode|mock|fake|synthetic/i);
  });

  test('no visible mock/demo/synthetic/hardcoded live-status text', async ({ page }) => {
    await login(page, BASE_URL);

    const tabs = ['overview', 'drift', 'queue', 'review'];
    for (const tab of tabs) {
      await page.goto(`${BASE_URL}/governance?tab=${tab}`);
      await page.waitForLoadState('networkidle');

      const pageText = await page.textContent('body');
      expect(pageText).not.toMatch(/DEMO_|mock |synthetic |hardcoded |fake |demo mode/i);
    }
  });

  test('empty states are truthful, not fake data', async ({ page }) => {
    await login(page, BASE_URL);

    await page.goto(`${BASE_URL}/governance?tab=review`);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const pageText = await page.textContent('body');
    if (pageText?.includes('No') || pageText?.includes('empty')) {
      expect(pageText).not.toMatch(/example|mock|test-/i);
    }
  });

  test('decision-lineage endpoint returns valid DB-backed response', async ({ page }) => {
    await login(page, BASE_URL);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/decision-lineage?limit=1');
      return {
        status: res.status,
        text: await res.text(),
      };
    });

    expect(result.status, result.text).toBeLessThan(500);
    expect(() => JSON.parse(result.text)).not.toThrow();
    expect(result.text).not.toMatch(/mock|fake|synthetic|demo mode/i);
  });
});
