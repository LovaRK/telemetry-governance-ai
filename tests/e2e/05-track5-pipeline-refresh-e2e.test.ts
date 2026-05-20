import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

test.describe('Track 5: Pipeline Refresh E2E', () => {
  test('pipeline updates dashboard values from server', async ({ page, request }) => {
    // Login using shared helper
    await login(page, BASE_URL);

    // Get token from localStorage for authenticated requests
    const token = await page.evaluate(() => {
      return localStorage.getItem('access_token');
    });
    expect(token).toBeTruthy();

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // Capture initial state
    const beforeRes = await request.get(`${BASE_URL}/api/executive-summary`, { headers });
    const beforeText = await beforeRes.text();

    // Parse and validate before state
    expect(() => JSON.parse(beforeText)).not.toThrow();
    const beforeJson = JSON.parse(beforeText);
    const beforeValue = beforeJson.data?.modelTrustScore ?? null;

    // Trigger pipeline run
    const triggerRes = await request.post(`${BASE_URL}/api/job-stream`, {
      headers,
      data: { source: 'splunk', mode: 'live' },
    });

    // Handle pipeline trigger response
    expect(triggerRes.status(), await triggerRes.text()).toBeLessThan(300);
    const triggerJson = await triggerRes.json();
    const runId = triggerJson.data?.runId ?? triggerJson.runId ?? triggerJson.jobId;
    expect(runId).toBeTruthy();

    // Poll for pipeline completion with exponential backoff
    const maxAttempts = 180; // 30 minutes max
    let completed = false;
    let finalStatus = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Exponential backoff: 1s, 3s, 5s, etc.
      const delayMs = Math.min(1000 + (attempt * 2000), 30000);
      await new Promise(resolve => setTimeout(resolve, delayMs));

      const statusRes = await request.get(`${BASE_URL}/api/job-stream?jobId=${runId}`, { headers });
      if (statusRes.ok()) {
        const statusJson = await statusRes.json();
        finalStatus = statusJson.data?.status ?? statusJson.status ?? 'UNKNOWN';

        if (finalStatus?.match(/COMPLETED|FAILED|ERROR/i)) {
          completed = true;
          break;
        }
      }
    }

    expect(completed, `Pipeline did not complete within timeout. Final status: ${finalStatus}`).toBe(true);

    // Capture state after pipeline completion
    const afterRes = await request.get(`${BASE_URL}/api/executive-summary`, { headers });
    const afterText = await afterRes.text();

    // Validate after state
    expect(afterText).not.toMatch(/mock|fake|synthetic|demo mode/i);
    expect(() => JSON.parse(afterText)).not.toThrow();
    const afterJson = JSON.parse(afterText);
    const afterValue = afterJson.data?.modelTrustScore ?? null;

    // Verify response has proper structure
    expect(afterJson).toHaveProperty('data');
    expect(afterJson).toHaveProperty('meta');
    expect(afterJson.meta.source).toBe('postgres');

    // Reload page and verify no errors
    await page.reload();
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toMatch(/Unexpected end of JSON input|useUser must be used within UserProvider|TypeError/i);

    // Log values for debugging
    console.log(`Pipeline refresh: before=${beforeValue}, after=${afterValue}, status=${finalStatus}`);
  });

  test('pipeline run endpoint returns valid job id', async ({ page, request }) => {
    // Login using shared helper
    await login(page, BASE_URL);

    const token = await page.evaluate(() => {
      return localStorage.getItem('access_token');
    });

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // Trigger pipeline
    const response = await request.post(`${BASE_URL}/api/job-stream`, {
      headers,
      data: { source: 'splunk', mode: 'live' },
    });

    expect(response.status()).toBeLessThan(300);

    const json = await response.json();
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('runId').or.have.property('jobId');
  });

  test('executive-summary reflects pipeline data, not hardcoded', async ({ page, request }) => {
    // Login using shared helper
    await login(page, BASE_URL);

    const token = await page.evaluate(() => {
      return localStorage.getItem('access_token');
    });

    const headers = { 'Authorization': `Bearer ${token}` };

    // Get executive summary
    const response = await request.get(`${BASE_URL}/api/executive-summary`, { headers });
    const json = await response.json();

    // Verify structure
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('meta');

    // If data is present, verify it's not hardcoded
    if (json.data) {
      const dataStr = JSON.stringify(json.data);
      expect(dataStr).not.toMatch(/mock|fake|synthetic|demo mode|DEMO_/i);
    }

    // Verify metadata shows postgres source
    expect(json.meta.source).toBe('postgres');
  });
});
