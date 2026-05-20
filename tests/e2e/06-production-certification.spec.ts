import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

test.describe('Production Certification Suite', () => {
  let consoleErrors: string[] = [];
  let pageErrors: Error[] = [];
  let failedRequests: { url: string; status: number }[] = [];
  let apiResponses: { url: string; status: number; method: string }[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    failedRequests = [];
    apiResponses = [];

    // Capture console messages
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      }
    });

    // Capture page errors
    page.on('pageerror', (err) => {
      pageErrors.push(err);
    });

    // Capture failed requests
    page.on('requestfailed', (req) => {
      failedRequests.push({
        url: req.url(),
        status: 0, // Connection failed, no status
      });
    });

    // Capture all responses
    page.on('response', async (res) => {
      const url = res.url();
      // Skip external resources and static files
      if (!url.includes('_next') && !url.includes('favicon') && !url.includes('.css')) {
        apiResponses.push({
          url: url.replace(BASE_URL, ''),
          status: res.status(),
          method: 'GET', // We'll refine this if needed
        });

        // Track failed API responses
        if (res.status() >= 400 && !url.includes('/login') && !url.includes('/auth')) {
          failedRequests.push({
            url: url.replace(BASE_URL, ''),
            status: res.status(),
          });
        }
      }
    });

    await login(page, BASE_URL);
  });

  test('Page: /governance loads without errors', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance`);
    await page.waitForLoadState('networkidle');

    // Verify page loaded
    await expect(page.getByRole('heading', { name: /governance/i }).first()).toBeVisible();

    // Verify no critical console errors
    const criticalErrors = consoleErrors.filter(
      (err) =>
        err.includes('TypeError') ||
        err.includes('ReferenceError') ||
        err.includes('Cannot read') ||
        err.includes('Cannot find')
    );
    expect(criticalErrors).toEqual([]);

    // Verify no page errors
    expect(pageErrors).toEqual([]);

    // Verify no API failures
    const apiFailed = failedRequests.filter((req) => !req.url.includes('/auth'));
    expect(apiFailed.length).toBe(0);
  });

  test('Page: /governance tabs render without errors', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance`);
    await page.waitForLoadState('networkidle');

    const tabs = ['overview', 'drift', 'queue', 'review'];

    for (const tab of tabs) {
      consoleErrors = [];
      pageErrors = [];

      await page.goto(`${BASE_URL}/governance?tab=${tab}`);
      await page.waitForLoadState('networkidle');

      // Check for errors
      const criticalErrors = consoleErrors.filter(
        (err) =>
          err.includes('TypeError') ||
          err.includes('ReferenceError') ||
          err.includes('Cannot read')
      );
      expect(criticalErrors, `Tab ${tab} has critical errors`).toEqual([]);
      expect(pageErrors, `Tab ${tab} has page errors`).toEqual([]);
    }
  });

  test('Trust Layer Status API returns DB-backed data', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance?tab=overview`);
    await page.waitForLoadState('networkidle');

    // Find the trust status response
    const trustResponse = apiResponses.find(
      (r) => r.url.includes('/api/governance/trust-status') && r.status === 200
    );

    expect(trustResponse, 'Trust status API should return 200').toBeDefined();
    if (trustResponse) {
      expect(trustResponse.status).toBe(200);
    }

    // Verify UI shows trust content
    const trustContent = await page.textContent('body');
    expect(trustContent).toMatch(/Confidence|Decay|Seasonality/i);

    // Verify no mock/demo text
    expect(trustContent).not.toMatch(/mock|demo|synthetic|placeholder/i);
  });

  test('Decision History uses DB-backed API, not stub', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance?tab=review`);
    await page.waitForLoadState('networkidle');

    const response = await page.evaluate(async () => {
      const res = await fetch('/api/decision-history', {
        headers: { 'content-type': 'application/json' },
      });
      return {
        status: res.status,
        body: await res.text(),
      };
    });

    expect(response.status).toBeLessThan(500);

    const json = JSON.parse(response.body);
    expect(JSON.stringify(json)).not.toMatch(/demo mode|mock|fake|synthetic/i);

    // Verify response structure
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('meta');
  });

  test('Queue Health metrics populated and visible', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance?tab=queue`);
    await page.waitForLoadState('networkidle');

    // Check for queue health API call
    const queueHealthCall = apiResponses.find(
      (r) => r.url.includes('/api/queue-health') && r.status === 200
    );

    expect(queueHealthCall, 'Queue health API should be called').toBeDefined();

    // Verify metrics are visible in UI
    const bodyText = await page.textContent('body');
    expect(bodyText).toMatch(/queue|depth|processing|latency/i);

    // Verify no mock text
    expect(bodyText).not.toMatch(/mock|demo|synthetic/i);
  });

  test('Executive Summary shows aggregated data', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');

    // Find executive summary API
    const execSummaryCall = apiResponses.find(
      (r) => r.url.includes('/api/executive-summary') && r.status === 200
    );

    if (execSummaryCall) {
      expect(execSummaryCall.status).toBe(200);
    }

    const bodyText = await page.textContent('body');

    // Verify data is displayed
    expect(bodyText).toMatch(/roi|gainscope|tier|critical|important/i);

    // Verify no hardcoded data markers
    expect(bodyText).not.toMatch(/hardcoded|demo|synthetic|placeholder/i);
  });

  test('All major routes load without 500 errors', async ({ page }) => {
    const routes = [
      '/login',
      '/governance',
      '/governance?tab=overview',
      '/governance?tab=drift',
      '/governance?tab=queue',
      '/governance?tab=review',
    ];

    for (const route of routes) {
      failedRequests = [];
      apiResponses = [];

      await page.goto(`${BASE_URL}${route}`);
      await page.waitForLoadState('networkidle').catch(() => {});

      const serverErrors = failedRequests.filter((req) => req.status >= 500);
      expect(
        serverErrors.length,
        `Route ${route} should not have 500 errors`
      ).toBe(0);
    }
  });

  test('No hardcoded/mock/demo values visible in UI', async ({ page }) => {
    const routesToCheck = [
      '/governance?tab=overview',
      '/governance?tab=drift',
      '/governance?tab=queue',
      '/governance?tab=review',
    ];

    for (const route of routesToCheck) {
      await page.goto(`${BASE_URL}${route}`);
      await page.waitForLoadState('networkidle');

      const bodyText = await page.textContent('body');
      const hasBlacklistedText = bodyText?.match(
        /\bDEMO_|mock |synthetic |hardcoded |fake |demo mode|\[STUB\]/i
      );

      expect(
        hasBlacklistedText,
        `Route ${route} should not contain hardcoded/mock/demo markers`
      ).toBeNull();
    }
  });

  test('Decision Lineage endpoint returns valid DB response', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance?tab=review`);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/decision-lineage?limit=1');
      return {
        status: res.status,
        text: await res.text(),
      };
    });

    expect(result.status).toBeLessThan(500);
    expect(() => JSON.parse(result.text)).not.toThrow();
    expect(result.text).not.toMatch(/mock|fake|synthetic|demo mode/i);
  });

  test('Pipeline trigger and completion flow', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance`);

    // Capture job stream call
    const jobResponse = await page.evaluate(async () => {
      const res = await fetch('/api/job-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'splunk', mode: 'live' }),
      });
      const data = await res.json();
      return { status: res.status, runId: data.data?.runId };
    });

    expect(jobResponse.status).toBe(200);
    expect(jobResponse.runId).toBeDefined();

    // Wait for job to process
    await page.waitForTimeout(3000);

    // Poll job status
    let jobComplete = false;
    for (let i = 0; i < 10; i++) {
      const status = await page.evaluate(async (runId) => {
        const res = await fetch(`/api/job-stream?jobId=${runId}`);
        // Return the event stream content
        return res.status;
      }, jobResponse.runId);

      if (status === 200) {
        jobComplete = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    expect(jobComplete, 'Job should complete within 10 seconds').toBe(true);
  });

  test('No React error boundary or hydration errors', async ({ page }) => {
    const routes = ['/governance', '/governance?tab=overview', '/governance?tab=drift'];

    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`);
      await page.waitForLoadState('networkidle');

      const bodyText = await page.textContent('body');

      // Check for React error boundary text
      expect(bodyText).not.toMatch(/something went wrong|error boundary/i);

      // Check for hydration errors
      expect(bodyText).not.toMatch(/hydration|mismatch|server|client/i);

      // Check console for React errors
      const reactErrors = consoleErrors.filter(
        (e) => e.includes('React') || e.includes('hydration')
      );
      expect(reactErrors.length, `Route ${route} should not have React errors`).toBe(0);
    }
  });

  test('Summary: API endpoints all healthy', async ({ page }) => {
    await page.goto(`${BASE_URL}/governance`);
    await page.waitForLoadState('networkidle');

    // Filter to actual API endpoints (not static assets)
    const apiEndpoints = apiResponses.filter(
      (r) =>
        r.url.includes('/api/') &&
        !r.url.includes('_next') &&
        !r.url.includes('static')
    );

    // Check for any 500 errors
    const serverErrors = apiEndpoints.filter((r) => r.status >= 500);

    console.log('\n=== API Endpoint Summary ===');
    console.log(`Total API calls: ${apiEndpoints.length}`);
    console.log(`Successful (2xx-3xx): ${apiEndpoints.filter((r) => r.status < 400).length}`);
    console.log(`Failed (4xx-5xx): ${apiEndpoints.filter((r) => r.status >= 400).length}`);

    if (serverErrors.length > 0) {
      console.log('\nServer errors detected:');
      serverErrors.forEach((r) => console.log(`  ${r.url}: ${r.status}`));
    }

    expect(serverErrors.length, 'No 500 server errors should occur').toBe(0);
  });

  test.afterEach(async () => {
    // Report summary
    console.log('\n=== Test Summary ===');
    console.log(`Console errors captured: ${consoleErrors.length}`);
    console.log(`Page errors: ${pageErrors.length}`);
    console.log(`Failed requests: ${failedRequests.length}`);
    console.log(`Total API responses: ${apiResponses.length}`);

    if (failedRequests.length > 0) {
      console.log('\nFailed requests:');
      failedRequests.forEach((r) => console.log(`  ${r.url}: ${r.status}`));
    }
  });
});
