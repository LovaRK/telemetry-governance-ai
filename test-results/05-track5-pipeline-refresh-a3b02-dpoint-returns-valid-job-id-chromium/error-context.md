# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-track5-pipeline-refresh-e2e.test.ts >> Track 5: Pipeline Refresh E2E >> pipeline run endpoint returns valid job id
- Location: tests/e2e/05-track5-pipeline-refresh-e2e.test.ts:59:7

# Error details

```
Error: expect(received).toHaveProperty(path)

Expected path: "runId"
Received path: []

Received value: {"jobId": "5069d771-618b-4c47-ba04-d0b5c00f8d7a"}
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e5]:
      - heading "Splunk Not Configured" [level=1] [ref=e6]
      - paragraph [ref=e7]: To view your Splunk telemetry intelligence dashboard, you need to configure your Splunk connection.
      - button "Configure Splunk Connection" [ref=e8] [cursor=pointer]
    - generic [ref=e9]:
      - text: ⚠️AI analysis failed. Raw data still available.
      - button "✕" [ref=e10]
  - button "Open Next.js Dev Tools" [ref=e16] [cursor=pointer]:
    - img [ref=e17]
  - alert [ref=e20]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { login } from './helpers/login';
  3   | import { TEST_TENANT_ID } from '../contract/_helpers';
  4   | 
  5   | const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';
  6   | 
  7   | test.describe('Track 5: Pipeline Refresh E2E', () => {
  8   |   test('pipeline updates dashboard values from server', async ({ page, request }) => {
  9   |     // Login using shared helper
  10  |     await login(page, BASE_URL);
  11  |     await page.waitForLoadState('domcontentloaded');
  12  | 
  13  |     // Get token from localStorage for authenticated requests
  14  |     const token = await page.evaluate(() => {
  15  |       return localStorage.getItem('access_token');
  16  |     });
  17  |     expect(token).toBeTruthy();
  18  | 
  19  |     const headers = {
  20  |       'Authorization': `Bearer ${token}`,
  21  |       'Content-Type': 'application/json',
  22  |       'x-tenant-id': TEST_TENANT_ID,
  23  |       'x-user-id': 'e2e-track5-user',
  24  |       'x-user-role': 'admin',
  25  |     };
  26  | 
  27  |     // Capture initial state
  28  |     const beforeRes = await request.get(`${BASE_URL}/api/executive-summary`, { headers });
  29  |     const beforeText = await beforeRes.text();
  30  | 
  31  |     // Parse and validate before state
  32  |     expect(() => JSON.parse(beforeText)).not.toThrow();
  33  |     const beforeJson = JSON.parse(beforeText);
  34  |     const beforeValue = beforeJson.data?.modelTrustScore ?? null;
  35  | 
  36  |     // Trigger pipeline run
  37  |     const triggerRes = await request.post(`${BASE_URL}/api/job-stream`, {
  38  |       headers,
  39  |       data: { source: 'splunk', mode: 'live' },
  40  |     });
  41  | 
  42  |     // Handle pipeline trigger response
  43  |     expect(triggerRes.status(), await triggerRes.text()).toBeLessThan(300);
  44  |     const triggerJson = await triggerRes.json();
  45  |     const runId = triggerJson.data?.runId ?? triggerJson.runId ?? triggerJson.jobId;
  46  |     expect(runId).toBeTruthy();
  47  | 
  48  |     // Verify pipeline endpoint contract (job creation successful)
  49  |     expect(runId).toBeTruthy();
  50  |     expect(triggerRes.status()).toBeLessThan(300);
  51  | 
  52  |     // Note: Full end-to-end refresh validation requires:
  53  |     // 1. Background job processor to execute pipeline
  54  |     // 2. Splunk integration to provide source data
  55  |     // 3. Dashboard refresh cycle to update display
  56  |     // This test validates the pipeline trigger endpoint is wired correctly.
  57  |   });
  58  | 
  59  |   test('pipeline run endpoint returns valid job id', async ({ page, request }) => {
  60  |     // Login using shared helper
  61  |     await login(page, BASE_URL);
  62  |     await page.waitForLoadState('domcontentloaded');
  63  | 
  64  |     const token = await page.evaluate(() => {
  65  |       return localStorage.getItem('access_token');
  66  |     });
  67  | 
  68  |     const headers = {
  69  |       'Authorization': `Bearer ${token}`,
  70  |       'Content-Type': 'application/json',
  71  |       'x-tenant-id': TEST_TENANT_ID,
  72  |       'x-user-id': 'e2e-track5-user',
  73  |       'x-user-role': 'admin',
  74  |     };
  75  | 
  76  |     // Trigger pipeline
  77  |     const response = await request.post(`${BASE_URL}/api/job-stream`, {
  78  |       headers,
  79  |       data: { source: 'splunk', mode: 'live' },
  80  |     });
  81  | 
  82  |     expect(response.status()).toBeLessThan(300);
  83  | 
  84  |     const json = await response.json();
  85  |     expect(json).toHaveProperty('data');
> 86  |     expect(json.data).toHaveProperty('runId');
      |                       ^ Error: expect(received).toHaveProperty(path)
  87  |   });
  88  | 
  89  |   test('executive-summary reflects pipeline data, not hardcoded', async ({ page, request }) => {
  90  |     // Login using shared helper
  91  |     await login(page, BASE_URL);
  92  |     await page.waitForLoadState('domcontentloaded');
  93  | 
  94  |     const token = await page.evaluate(() => {
  95  |       return localStorage.getItem('access_token');
  96  |     });
  97  | 
  98  |     const headers = {
  99  |       'Authorization': `Bearer ${token}`,
  100 |       'x-tenant-id': TEST_TENANT_ID,
  101 |       'x-user-id': 'e2e-track5-user',
  102 |       'x-user-role': 'admin',
  103 |     };
  104 | 
  105 |     // Get executive summary
  106 |     const response = await request.get(`${BASE_URL}/api/executive-summary`, { headers });
  107 |     const json = await response.json();
  108 | 
  109 |     // Verify response has proper structure
  110 |     expect(json).toHaveProperty('meta');
  111 | 
  112 |     // Response can be either: data object OR error message (both are valid)
  113 |     const hasData = json.hasOwnProperty('data');
  114 |     const hasError = json.hasOwnProperty('error');
  115 |     expect(hasData || hasError, 'Response must have either data or error').toBe(true);
  116 | 
  117 |     // If data is present, verify it's not hardcoded
  118 |     if (json.data) {
  119 |       const dataStr = JSON.stringify(json.data);
  120 |       expect(dataStr).not.toMatch(/mock|fake|synthetic|demo mode|DEMO_/i);
  121 |       // Verify data came from postgres, not hardcoded fallback
  122 |       expect(json.meta.source).toBe('postgres');
  123 |     }
  124 | 
  125 |     // If error, it should indicate no refresh has been run (not an internal error)
  126 |     if (json.error) {
  127 |       expect(json.error).toMatch(/No data available|refresh|Splunk/i);
  128 |     }
  129 |   });
  130 | });
  131 | 
```