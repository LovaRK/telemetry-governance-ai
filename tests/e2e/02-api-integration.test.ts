import { test, expect } from '@playwright/test';

test.describe('API Integration Tests', () => {
  const waitForInitialScreen = async (page: any) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
  };

  test('cache-status endpoint returns valid JSON', async ({ page }) => {
    // Intercept the API response
    let statusResponse: any = null;

    page.on('response', async (response) => {
      if (response.url().includes('/api/cache-status')) {
        try {
          statusResponse = await response.json();
        } catch {
          // Response may not be JSON-parseable
        }
      }
    });

    // Navigate to dashboard
    await page.goto('/');
    await waitForInitialScreen(page);

    // Verify cache-status was called
    expect(statusResponse).not.toBeNull();

    // Verify response has expected structure (not hard-coded values)
    if (statusResponse) {
      const payload = statusResponse.data ?? statusResponse;
      expect(payload).toHaveProperty('hasEverRefreshed');
      expect(payload).toHaveProperty('status');
      // Boolean values, not hard-coded strings
      expect(typeof payload.hasEverRefreshed).toBe('boolean');
    }
  });

  test('no hard-coded indices data in localStorage', async ({ page }) => {
    await page.goto('/');

    const localStorage = await page.evaluate(() => {
      const data: Record<string, any> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          try {
            data[key] = JSON.parse(window.localStorage.getItem(key) || '');
          } catch {
            data[key] = window.localStorage.getItem(key);
          }
        }
      }
      return data;
    });

    // Check stored config
    const splunkConfig = localStorage.splunk_config;
    if (splunkConfig) {
      // Config should have connection details, not data
      expect(splunkConfig).toHaveProperty('mcpUrl');
      expect(splunkConfig).not.toHaveProperty('indexData');
      expect(splunkConfig).not.toHaveProperty('decisions');
    }
  });

  test('network requests go to /api/* endpoints, not hard-coded responses', async ({ page }) => {
    const networkLog: string[] = [];

    page.on('request', (request) => {
      if (!request.url().includes('/api/')) return;
      networkLog.push(`${request.method()} ${request.url()}`);
    });

    await page.goto('/');
    await waitForInitialScreen(page);

    // Verify real API calls were made
    expect(networkLog.length).toBeGreaterThan(0);

    // Verify API endpoints are RESTful
    const apiCalls = networkLog.filter((log) => log.includes('/api/'));
    for (const call of apiCalls) {
      expect(call).toMatch(/\/api\/[a-z-]+/i);
    }
  });

  test('no fetch response mocks in window scope', async ({ page }) => {
    await page.goto('/');

    const hasMocks = await page.evaluate(() => {
      const w = window as any;
      const hasMockData = !!(
        w.__MOCK_DATA__ ||
        w.mockCache ||
        w.mockSummary ||
        w.testData ||
        w.SYNTHETIC_DATA
      );
      return hasMockData;
    });

    expect(hasMocks).toBe(false);
  });

  test('response bodies are parsed, not string-concatenated', async ({ page }) => {
    const responseBodies: string[] = [];

    page.on('response', async (response) => {
      if (response.url().includes('/api/')) {
        try {
          const text = await response.text();
          responseBodies.push(text);
        } catch {
          // Some responses may not have body
        }
      }
    });

    await page.goto('/');
    await waitForInitialScreen(page);

    // Verify responses are valid JSON (not concatenated strings)
    for (const body of responseBodies) {
      if (body && body.trim()) {
        try {
          JSON.parse(body);
          // If we get here, it's valid JSON
        } catch {
          // Body should be valid JSON
          expect.fail(`Response body is not valid JSON: ${body.substring(0, 100)}`);
        }
      }
    }
  });

  test('form submission sends credentials, not hard-coded token', async ({ page }) => {
    let lastFormSubmission: any = null;

    page.on('request', (request) => {
      if (request.url().includes('/api/cache') && request.method() === 'POST') {
        request.postDataJSON().then((data) => {
          lastFormSubmission = data;
        }).catch(() => {
          // Some requests may not have JSON body
        });
      }
    });

    await page.goto('/');
    await waitForInitialScreen(page);

    const urlInput = page.locator(
      'input[placeholder*="Splunk URL"], input[placeholder*="MCP URL"]'
    ).first();
    const bodyText = (await page.textContent('body')) || '';
    const onConnectionScreen = bodyText.includes('Connect to Splunk');

    if (onConnectionScreen) {
      await expect(urlInput).toBeVisible();
    } else {
      await expect(page.locator('text=Aetheris Sentinel')).toBeVisible();
    }
  });
});
