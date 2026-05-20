# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-api-integration.test.ts >> API Integration Tests >> cache-status endpoint returns valid JSON
- Location: tests/e2e/02-api-integration.test.ts:4:7

# Error details

```
Error: expect(received).toHaveProperty(path)

Expected path: "hasEverRefreshed"
Received path: []

Received value: {"data": {"hasAgentDecisions": true, "hasData": true, "hasEverRefreshed": true, "lastRefreshAt": "2026-05-20T16:01:53.312Z", "message": "Cache is ready", "nextRefreshAt": null, "recordCount": 3, "status": "fast_complete"}, "meta": {"mode": "live", "source": "postgres", "traceId": "497c259d-23ef-4b52-be4a-d918cd3b0252"}}
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]: d
      - heading "datasensAI" [level=1] [ref=e7]
      - paragraph [ref=e8]: Sign in to continue
    - generic [ref=e9]:
      - generic [ref=e10]:
        - generic [ref=e11]: EMAIL
        - textbox [ref=e12]: admin@demo.local
      - generic [ref=e13]:
        - generic [ref=e14]: PASSWORD
        - textbox "Enter password" [ref=e15]
      - button "Sign In" [ref=e16] [cursor=pointer]
    - paragraph [ref=e17]: "Default: admin@demo.local / Demo@12345"
  - generic [ref=e22] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e23]:
      - img [ref=e24]
    - generic [ref=e27]:
      - button "Open issues overlay" [ref=e28]:
        - generic [ref=e29]:
          - generic [ref=e30]: "0"
          - generic [ref=e31]: "1"
        - generic [ref=e32]: Issue
      - button "Collapse issues badge" [ref=e33]:
        - img [ref=e34]
  - alert [ref=e36]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('API Integration Tests', () => {
  4   |   test('cache-status endpoint returns valid JSON', async ({ page }) => {
  5   |     // Intercept the API response
  6   |     let statusResponse: any = null;
  7   | 
  8   |     page.on('response', async (response) => {
  9   |       if (response.url().includes('/api/cache-status')) {
  10  |         try {
  11  |           statusResponse = await response.json();
  12  |         } catch {
  13  |           // Response may not be JSON-parseable
  14  |         }
  15  |       }
  16  |     });
  17  | 
  18  |     // Navigate to dashboard
  19  |     await page.goto('/');
  20  | 
  21  |     // Wait for API calls
  22  |     await page.waitForTimeout(2000);
  23  | 
  24  |     // Verify cache-status was called
  25  |     expect(statusResponse).not.toBeNull();
  26  | 
  27  |     // Verify response has expected structure (not hard-coded values)
  28  |     if (statusResponse) {
> 29  |       expect(statusResponse).toHaveProperty('hasEverRefreshed');
      |                              ^ Error: expect(received).toHaveProperty(path)
  30  |       expect(statusResponse).toHaveProperty('status');
  31  |       // Boolean values, not hard-coded strings
  32  |       expect(typeof statusResponse.hasEverRefreshed).toBe('boolean');
  33  |     }
  34  |   });
  35  | 
  36  |   test('no hard-coded indices data in localStorage', async ({ page }) => {
  37  |     await page.goto('/');
  38  | 
  39  |     const localStorage = await page.evaluate(() => {
  40  |       const data: Record<string, any> = {};
  41  |       for (let i = 0; i < window.localStorage.length; i++) {
  42  |         const key = window.localStorage.key(i);
  43  |         if (key) {
  44  |           try {
  45  |             data[key] = JSON.parse(window.localStorage.getItem(key) || '');
  46  |           } catch {
  47  |             data[key] = window.localStorage.getItem(key);
  48  |           }
  49  |         }
  50  |       }
  51  |       return data;
  52  |     });
  53  | 
  54  |     // Check stored config
  55  |     const splunkConfig = localStorage.splunk_config;
  56  |     if (splunkConfig) {
  57  |       // Config should have connection details, not data
  58  |       expect(splunkConfig).toHaveProperty('mcpUrl');
  59  |       expect(splunkConfig).not.toHaveProperty('indexData');
  60  |       expect(splunkConfig).not.toHaveProperty('decisions');
  61  |     }
  62  |   });
  63  | 
  64  |   test('network requests go to /api/* endpoints, not hard-coded responses', async ({ page }) => {
  65  |     const networkLog: string[] = [];
  66  | 
  67  |     page.on('request', (request) => {
  68  |       if (!request.url().includes('/api/')) return;
  69  |       networkLog.push(`${request.method()} ${request.url()}`);
  70  |     });
  71  | 
  72  |     await page.goto('/');
  73  |     await page.waitForTimeout(2000);
  74  | 
  75  |     // Verify real API calls were made
  76  |     expect(networkLog.length).toBeGreaterThan(0);
  77  | 
  78  |     // Verify API endpoints are RESTful
  79  |     const apiCalls = networkLog.filter((log) => log.includes('/api/'));
  80  |     for (const call of apiCalls) {
  81  |       expect(call).toMatch(/\/api\/[a-z-]+/i);
  82  |     }
  83  |   });
  84  | 
  85  |   test('no fetch response mocks in window scope', async ({ page }) => {
  86  |     await page.goto('/');
  87  | 
  88  |     const hasMocks = await page.evaluate(() => {
  89  |       const w = window as any;
  90  |       const hasMockData = !!(
  91  |         w.__MOCK_DATA__ ||
  92  |         w.mockCache ||
  93  |         w.mockSummary ||
  94  |         w.testData ||
  95  |         w.SYNTHETIC_DATA
  96  |       );
  97  |       return hasMockData;
  98  |     });
  99  | 
  100 |     expect(hasMocks).toBe(false);
  101 |   });
  102 | 
  103 |   test('response bodies are parsed, not string-concatenated', async ({ page }) => {
  104 |     const responseBodies: string[] = [];
  105 | 
  106 |     page.on('response', async (response) => {
  107 |       if (response.url().includes('/api/')) {
  108 |         try {
  109 |           const text = await response.text();
  110 |           responseBodies.push(text);
  111 |         } catch {
  112 |           // Some responses may not have body
  113 |         }
  114 |       }
  115 |     });
  116 | 
  117 |     await page.goto('/');
  118 |     await page.waitForTimeout(2000);
  119 | 
  120 |     // Verify responses are valid JSON (not concatenated strings)
  121 |     for (const body of responseBodies) {
  122 |       if (body && body.trim()) {
  123 |         try {
  124 |           JSON.parse(body);
  125 |           // If we get here, it's valid JSON
  126 |         } catch {
  127 |           // Body should be valid JSON
  128 |           expect.fail(`Response body is not valid JSON: ${body.substring(0, 100)}`);
  129 |         }
```