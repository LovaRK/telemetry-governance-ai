# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 06-production-certification.spec.ts >> Production Certification Suite >> Page: /governance tabs render without errors
- Location: tests/e2e/06-production-certification.spec.ts:91:7

# Error details

```
Error: page.waitForTimeout: Target page, context or browser has been closed
```

```
Error: write EPIPE
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { login } from './helpers/login';
  3   | 
  4   | const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';
  5   | 
  6   | test.describe('Production Certification Suite', () => {
  7   |   let consoleErrors: string[] = [];
  8   |   let pageErrors: Error[] = [];
  9   |   let failedRequests: { url: string; status: number }[] = [];
  10  |   let apiResponses: { url: string; status: number; method: string }[] = [];
  11  | 
  12  |   test.beforeEach(async ({ page }) => {
  13  |     consoleErrors = [];
  14  |     pageErrors = [];
  15  |     failedRequests = [];
  16  |     apiResponses = [];
  17  | 
  18  |     // Capture console messages
  19  |     page.on('console', (msg) => {
  20  |       const text = msg.text();
  21  |       if (msg.type() === 'error') {
  22  |         consoleErrors.push(text);
  23  |       }
  24  |     });
  25  | 
  26  |     // Capture page errors
  27  |     page.on('pageerror', (err) => {
  28  |       pageErrors.push(err);
  29  |     });
  30  | 
  31  |     // Capture failed requests
  32  |     page.on('requestfailed', (req) => {
  33  |       failedRequests.push({
  34  |         url: req.url(),
  35  |         status: 0, // Connection failed, no status
  36  |       });
  37  |     });
  38  | 
  39  |     // Capture all responses
  40  |     page.on('response', async (res) => {
  41  |       const url = res.url();
  42  |       // Skip external resources and static files
  43  |       if (!url.includes('_next') && !url.includes('favicon') && !url.includes('.css')) {
  44  |         apiResponses.push({
  45  |           url: url.replace(BASE_URL, ''),
  46  |           status: res.status(),
  47  |           method: 'GET', // We'll refine this if needed
  48  |         });
  49  | 
  50  |         // Track failed API responses
  51  |         if (res.status() >= 400 && !url.includes('/login') && !url.includes('/auth')) {
  52  |           failedRequests.push({
  53  |             url: url.replace(BASE_URL, ''),
  54  |             status: res.status(),
  55  |           });
  56  |         }
  57  |       }
  58  |     });
  59  | 
  60  |     await login(page, BASE_URL);
  61  |   });
  62  | 
  63  |   test('Page: /governance loads without errors', async ({ page }) => {
  64  |     await page.goto(`${BASE_URL}/governance`);
  65  |     await page.waitForLoadState('domcontentloaded');
  66  |     await page.waitForTimeout(3000);
  67  | 
  68  |     // Verify page loaded
  69  |     await expect(page.getByRole('heading', { name: /governance/i }).first()).toBeVisible();
  70  | 
  71  |     // Verify no critical console errors
  72  |     const criticalErrors = consoleErrors.filter(
  73  |       (err) =>
  74  |         err.includes('TypeError') ||
  75  |         err.includes('ReferenceError') ||
  76  |         err.includes('Cannot read') ||
  77  |         err.includes('Cannot find')
  78  |     );
  79  |     expect(criticalErrors).toEqual([]);
  80  | 
  81  |     // Verify no page errors
  82  |     expect(pageErrors).toEqual([]);
  83  | 
  84  |     // Verify no API failures (exclude stream/SSE disconnects, auth-required endpoints, and external deps)
  85  |     const apiFailed = failedRequests.filter(
  86  |       (req) => !req.url.includes('/auth') && req.status !== 0 && !req.url.includes('/test-connection') && !req.url.includes('/settings/explainability')
  87  |     );
  88  |     expect(apiFailed.length).toBe(0);
  89  |   });
  90  | 
  91  |   test('Page: /governance tabs render without errors', async ({ page }) => {
  92  |     await page.goto(`${BASE_URL}/governance`);
  93  |     await page.waitForLoadState('domcontentloaded');
> 94  |     await page.waitForTimeout(3000);
      |     ^ Error: write EPIPE
  95  | 
  96  |     const tabs = ['overview', 'drift', 'queue', 'review'];
  97  | 
  98  |     for (const tab of tabs) {
  99  |       consoleErrors = [];
  100 |       pageErrors = [];
  101 | 
  102 |       await page.goto(`${BASE_URL}/governance?tab=${tab}`);
  103 |       await page.waitForLoadState('domcontentloaded');
  104 |     await page.waitForTimeout(3000);
  105 | 
  106 |       // Check for errors
  107 |       const criticalErrors = consoleErrors.filter(
  108 |         (err) =>
  109 |           err.includes('TypeError') ||
  110 |           err.includes('ReferenceError') ||
  111 |           err.includes('Cannot read')
  112 |       );
  113 |       expect(criticalErrors, `Tab ${tab} has critical errors`).toEqual([]);
  114 |       expect(pageErrors, `Tab ${tab} has page errors`).toEqual([]);
  115 |     }
  116 |   });
  117 | 
  118 |   test('Trust Layer Status API returns DB-backed data', async ({ page }) => {
  119 |     await page.goto(`${BASE_URL}/governance?tab=overview`);
  120 |     await page.waitForLoadState('domcontentloaded');
  121 |     await page.waitForTimeout(3000);
  122 | 
  123 |     // Find the trust status response
  124 |     const trustResponse = apiResponses.find(
  125 |       (r) => r.url.includes('/api/governance/trust-status') && r.status === 200
  126 |     );
  127 | 
  128 |     expect(trustResponse, 'Trust status API should return 200').toBeDefined();
  129 |     if (trustResponse) {
  130 |       expect(trustResponse.status).toBe(200);
  131 |     }
  132 | 
  133 |     // Verify UI shows trust content
  134 |     const trustContent = await page.textContent('body');
  135 |     expect(trustContent).toMatch(/Confidence|Decay|Seasonality/i);
  136 | 
  137 |     // Verify no mock/demo text
  138 |     expect(trustContent).not.toMatch(/mock|\bdemo\b|synthetic|placeholder/i);
  139 |   });
  140 | 
  141 |   test('Decision History uses DB-backed API, not stub', async ({ page }) => {
  142 |     await page.goto(`${BASE_URL}/governance?tab=review`);
  143 |     await page.waitForLoadState('domcontentloaded');
  144 |     await page.waitForTimeout(3000);
  145 | 
  146 |     const response = await page.evaluate(async () => {
  147 |       const res = await fetch('/api/decision-history', {
  148 |         headers: { 'content-type': 'application/json' },
  149 |       });
  150 |       return {
  151 |         status: res.status,
  152 |         body: await res.text(),
  153 |       };
  154 |     });
  155 | 
  156 |     expect(response.status).toBeLessThan(500);
  157 | 
  158 |     const json = JSON.parse(response.body);
  159 |     expect(JSON.stringify(json)).not.toMatch(/demo mode|mock|fake|synthetic/i);
  160 | 
  161 |     // Verify response structure
  162 |     expect(json).toHaveProperty('data');
  163 |     expect(json).toHaveProperty('meta');
  164 |   });
  165 | 
  166 |   test('Queue Health metrics populated and visible', async ({ page }) => {
  167 |     await page.goto(`${BASE_URL}/governance?tab=queue`);
  168 |     await page.waitForLoadState('domcontentloaded');
  169 |     await page.waitForTimeout(3000);
  170 | 
  171 |     // Check for queue health API call
  172 |     const queueHealthCall = apiResponses.find(
  173 |       (r) => r.url.includes('/api/queue-health') && r.status === 200
  174 |     );
  175 | 
  176 |     expect(queueHealthCall, 'Queue health API should be called').toBeDefined();
  177 | 
  178 |     // Verify metrics are visible in UI
  179 |     const bodyText = await page.textContent('body');
  180 |     expect(bodyText).toMatch(/queue|depth|processing|latency/i);
  181 | 
  182 |     // Verify no mock text
  183 |     expect(bodyText).not.toMatch(/mock|\bdemo\b|synthetic/i);
  184 |   });
  185 | 
  186 |   test('Executive Summary shows aggregated data', async ({ page }) => {
  187 |     await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  188 |     await page.waitForTimeout(3000);
  189 | 
  190 |     // Find executive summary API
  191 |     const execSummaryCall = apiResponses.find(
  192 |       (r) => r.url.includes('/api/executive-summary') && r.status === 200
  193 |     );
  194 | 
```