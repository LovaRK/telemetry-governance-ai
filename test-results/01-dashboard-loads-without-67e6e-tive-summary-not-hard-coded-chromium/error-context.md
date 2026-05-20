# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-dashboard-loads-without-hardcoded-data.test.ts >> Dashboard E2E Tests >> API calls are made for executive-summary, not hard-coded
- Location: tests/e2e/01-dashboard-loads-without-hardcoded-data.test.ts:29:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Connect to Splunk to get started')
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('text=Connect to Splunk to get started')

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Dashboard E2E Tests', () => {
  4   |   test('connection screen loads without hard-coded data', async ({ page }) => {
  5   |     // Navigate to dashboard
  6   |     await page.goto('/');
  7   | 
  8   |     // Should show connection form (no data has been loaded yet)
  9   |     await expect(page.locator('text=datasensAI')).toBeVisible();
  10  |     await expect(page.locator('text=Connect to Splunk to get started')).toBeVisible();
  11  | 
  12  |     // Verify connection form elements are present
  13  |     const splunkUrlInput = page.locator('input[placeholder*="Splunk URL"]').first();
  14  |     await expect(splunkUrlInput).toBeVisible();
  15  | 
  16  |     // The entire connection screen should be empty of any hard-coded data
  17  |     // No synthetic decisions, indexes, or metrics should be visible
  18  |     const bodyText = await page.textContent('body');
  19  |     const hasHardcodedData = (
  20  |       bodyText?.includes('test-index') ||
  21  |       bodyText?.includes('DEMO_') ||
  22  |       bodyText?.includes('synthetic') ||
  23  |       bodyText?.includes('mock-')
  24  |     );
  25  | 
  26  |     expect(hasHardcodedData).toBe(false);
  27  |   });
  28  | 
  29  |   test('API calls are made for executive-summary, not hard-coded', async ({ page }) => {
  30  |     // Start listening for all network requests
  31  |     const apiRequests: string[] = [];
  32  |     page.on('request', (request) => {
  33  |       apiRequests.push(request.url());
  34  |     });
  35  | 
  36  |     // Navigate to dashboard
  37  |     await page.goto('/');
  38  | 
  39  |     // Wait for initial requests to complete
  40  |     await page.waitForTimeout(2000);
  41  | 
  42  |     // Verify that cache-status API is called
  43  |     const hasStatusCall = apiRequests.some((url) => url.includes('/api/cache-status'));
  44  |     expect(hasStatusCall).toBe(true);
  45  | 
  46  |     // Connection screen should be shown (no Splunk connection yet)
  47  |     // This means executive-summary should NOT be called
> 48  |     await expect(page.locator('text=Connect to Splunk to get started')).toBeVisible();
      |                                                                         ^ Error: expect(locator).toBeVisible() failed
  49  |   });
  50  | 
  51  |   test('no synthetic data leaks into DOM', async ({ page }) => {
  52  |     await page.goto('/');
  53  | 
  54  |     // Collect all text content from the page
  55  |     const pageContent = await page.textContent('html');
  56  | 
  57  |     // List of patterns that would indicate synthetic/hard-coded data
  58  |     const suspiciousPatterns = [
  59  |       /SYNTHETIC_INDEX_\d+/i,
  60  |       /MOCK_TENANT_\d+/i,
  61  |       /FAKE_/i,
  62  |       /TEST_DATA_/i,
  63  |       /DEMO_INDEX_/i,
  64  |       /hardcoded/i,
  65  |       /placeholder metric/i,
  66  |     ];
  67  | 
  68  |     for (const pattern of suspiciousPatterns) {
  69  |       const found = pattern.test(pageContent || '');
  70  |       expect(found, `Found suspicious pattern: ${pattern.source}`).toBe(false);
  71  |     }
  72  |   });
  73  | 
  74  |   test('localStorage is used for configuration only, not data', async ({ page }) => {
  75  |     // Wait for page to fully load
  76  |     await page.waitForLoadState('domcontentloaded');
  77  | 
  78  |     // Get localStorage content
  79  |     const localStorageContent = await page.evaluate(() => {
  80  |       try {
  81  |         const storage: Record<string, string> = {};
  82  |         for (let i = 0; i < localStorage.length; i++) {
  83  |           const key = localStorage.key(i);
  84  |           if (key) {
  85  |             storage[key] = localStorage.getItem(key) || '';
  86  |           }
  87  |         }
  88  |         return storage;
  89  |       } catch {
  90  |         return {}; // localStorage may not be accessible
  91  |       }
  92  |     });
  93  | 
  94  |     // localStorage should only contain configuration, not data
  95  |     const isConfigOnly = Object.keys(localStorageContent).every((key) => {
  96  |       return key.includes('config') || key.includes('auth') || key.includes('splunk');
  97  |     });
  98  | 
  99  |     expect(isConfigOnly).toBe(true);
  100 |   });
  101 | 
  102 |   test('CSS does not hard-code style data or metrics', async ({ page }) => {
  103 |     await page.goto('/');
  104 | 
  105 |     // Get all computed styles
  106 |     const styles = await page.evaluate(() => {
  107 |       const allElements = document.querySelectorAll('*');
  108 |       const styleStrings: string[] = [];
  109 | 
  110 |       allElements.forEach((el) => {
  111 |         const style = window.getComputedStyle(el);
  112 |         const content = style.content;
  113 |         if (content && content !== 'none') {
  114 |           styleStrings.push(content);
  115 |         }
  116 |       });
  117 | 
  118 |       return styleStrings;
  119 |     });
  120 | 
  121 |     // CSS content should not contain data
  122 |     for (const style of styles) {
  123 |       expect(style).not.toMatch(/\d+\.\d+%.*index/i);
  124 |       expect(style).not.toMatch(/SYNTHETIC/i);
  125 |       expect(style).not.toMatch(/DEMO/i);
  126 |     }
  127 |   });
  128 | 
  129 |   test('component tree has no hidden hard-coded data in attributes', async ({ page }) => {
  130 |     await page.goto('/');
  131 | 
  132 |     // Check all elements for data-* attributes with hard-coded data
  133 |     const hiddenData = await page.evaluate(() => {
  134 |       const issues: string[] = [];
  135 |       const elements = document.querySelectorAll('[class], [id], [data-testid]');
  136 | 
  137 |       elements.forEach((el) => {
  138 |         Array.from(el.attributes).forEach((attr) => {
  139 |           if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'id') {
  140 |             const value = attr.value || '';
  141 |             if (/SYNTHETIC|MOCK|DEMO|hardcoded|test-only/i.test(value)) {
  142 |               issues.push(`${attr.name}=${value}`);
  143 |             }
  144 |           }
  145 |         });
  146 |       });
  147 | 
  148 |       return issues;
```