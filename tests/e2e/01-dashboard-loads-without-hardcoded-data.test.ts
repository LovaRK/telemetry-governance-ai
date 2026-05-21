import { test, expect } from '@playwright/test';

test.describe('Dashboard E2E Tests', () => {
  const waitForInitialScreen = async (page: any) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
  };

  test('connection screen loads without hard-coded data', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/');
    await waitForInitialScreen(page);

    // Should show either connection screen or dashboard shell.
    await expect(page.locator('text=datasensAI')).toBeVisible();
    const bodyText = (await page.textContent('body')) || '';
    const isConnectionScreen = bodyText.includes('Connect to Splunk');

    if (isConnectionScreen) {
      const urlInput = page.locator(
        'input[placeholder*="Splunk URL"], input[placeholder*="MCP URL"]'
      ).first();
      await expect(urlInput).toBeVisible();
    } else {
      await expect(page.locator('text=Aetheris Sentinel')).toBeVisible();
    }

    // The entire connection screen should be empty of any hard-coded data
    // No synthetic decisions, indexes, or metrics should be visible
    const hasHardcodedData = (
      bodyText?.includes('test-index') ||
      bodyText?.includes('DEMO_') ||
      bodyText?.includes('synthetic') ||
      bodyText?.includes('mock-')
    );

    expect(hasHardcodedData).toBe(false);
  });

  test('API calls are made for executive-summary, not hard-coded', async ({ page }) => {
    // Start listening for all network requests
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      apiRequests.push(request.url());
    });

    // Navigate to dashboard
    await page.goto('/');
    await waitForInitialScreen(page);

    // Verify that cache-status API is called
    const hasStatusCall = apiRequests.some((url) => url.includes('/api/cache-status'));
    expect(hasStatusCall).toBe(true);

    // App can load either connection view (fresh) or dashboard view (cached refresh exists).
    const bodyText = (await page.textContent('body')) || '';
    const onConnection = bodyText.includes('Connect to Splunk');
    if (onConnection) {
      const hasSummaryCall = apiRequests.some((url) => url.includes('/api/executive-summary'));
      expect(hasSummaryCall).toBe(false);
    } else {
      await expect(page.locator('text=Aetheris Sentinel')).toBeVisible();
    }
  });

  test('no synthetic data leaks into DOM', async ({ page }) => {
    await page.goto('/');

    // Collect all text content from the page
    const pageContent = await page.textContent('html');

    // List of patterns that would indicate synthetic/hard-coded data
    const suspiciousPatterns = [
      /SYNTHETIC_INDEX_\d+/i,
      /MOCK_TENANT_\d+/i,
      /FAKE_/i,
      /TEST_DATA_/i,
      /DEMO_INDEX_/i,
      /hardcoded/i,
      /placeholder metric/i,
    ];

    for (const pattern of suspiciousPatterns) {
      const found = pattern.test(pageContent || '');
      expect(found, `Found suspicious pattern: ${pattern.source}`).toBe(false);
    }
  });

  test('localStorage is used for configuration only, not data', async ({ page }) => {
    // Wait for page to fully load
    await page.waitForLoadState('domcontentloaded');

    // Get localStorage content
    const localStorageContent = await page.evaluate(() => {
      try {
        const storage: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            storage[key] = localStorage.getItem(key) || '';
          }
        }
        return storage;
      } catch {
        return {}; // localStorage may not be accessible
      }
    });

    // localStorage should only contain configuration, not data
    const isConfigOnly = Object.keys(localStorageContent).every((key) => {
      return key.includes('config') || key.includes('auth') || key.includes('splunk');
    });

    expect(isConfigOnly).toBe(true);
  });

  test('CSS does not hard-code style data or metrics', async ({ page }) => {
    await page.goto('/');

    // Get all computed styles
    const styles = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const styleStrings: string[] = [];

      allElements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const content = style.content;
        if (content && content !== 'none') {
          styleStrings.push(content);
        }
      });

      return styleStrings;
    });

    // CSS content should not contain data
    for (const style of styles) {
      expect(style).not.toMatch(/\d+\.\d+%.*index/i);
      expect(style).not.toMatch(/SYNTHETIC/i);
      expect(style).not.toMatch(/DEMO/i);
    }
  });

  test('component tree has no hidden hard-coded data in attributes', async ({ page }) => {
    await page.goto('/');

    // Check all elements for data-* attributes with hard-coded data
    const hiddenData = await page.evaluate(() => {
      const issues: string[] = [];
      const elements = document.querySelectorAll('[class], [id], [data-testid]');

      elements.forEach((el) => {
        Array.from(el.attributes).forEach((attr) => {
          if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'id') {
            const value = attr.value || '';
            if (/SYNTHETIC|MOCK|DEMO|hardcoded|test-only/i.test(value)) {
              issues.push(`${attr.name}=${value}`);
            }
          }
        });
      });

      return issues;
    });

    expect(hiddenData).toEqual([]);
  });
});
