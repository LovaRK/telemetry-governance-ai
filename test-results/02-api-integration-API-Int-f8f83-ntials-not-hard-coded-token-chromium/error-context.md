# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-api-integration.test.ts >> API Integration Tests >> form submission sends credentials, not hard-coded token
- Location: tests/e2e/02-api-integration.test.ts:143:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=datasensAI')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('text=datasensAI')

```

```yaml
- heading "Splunk Not Configured" [level=1]
- paragraph: To view your Splunk telemetry intelligence dashboard, you need to configure your Splunk connection.
- button "Configure Splunk Connection"
- alert
```

# Test source

```ts
  68  |       expect(splunkConfig).not.toHaveProperty('indexData');
  69  |       expect(splunkConfig).not.toHaveProperty('decisions');
  70  |     }
  71  |   });
  72  | 
  73  |   test('network requests go to /api/* endpoints, not hard-coded responses', async ({ page }) => {
  74  |     const networkLog: string[] = [];
  75  | 
  76  |     page.on('request', (request) => {
  77  |       if (!request.url().includes('/api/')) return;
  78  |       networkLog.push(`${request.method()} ${request.url()}`);
  79  |     });
  80  | 
  81  |     await page.goto('/');
  82  |     await waitForInitialScreen(page);
  83  | 
  84  |     // Verify real API calls were made
  85  |     expect(networkLog.length).toBeGreaterThan(0);
  86  | 
  87  |     // Verify API endpoints are RESTful
  88  |     const apiCalls = networkLog.filter((log) => log.includes('/api/'));
  89  |     for (const call of apiCalls) {
  90  |       expect(call).toMatch(/\/api\/[a-z-]+/i);
  91  |     }
  92  |   });
  93  | 
  94  |   test('no fetch response mocks in window scope', async ({ page }) => {
  95  |     await page.goto('/');
  96  | 
  97  |     const hasMocks = await page.evaluate(() => {
  98  |       const w = window as any;
  99  |       const hasMockData = !!(
  100 |         w.__MOCK_DATA__ ||
  101 |         w.mockCache ||
  102 |         w.mockSummary ||
  103 |         w.testData ||
  104 |         w.SYNTHETIC_DATA
  105 |       );
  106 |       return hasMockData;
  107 |     });
  108 | 
  109 |     expect(hasMocks).toBe(false);
  110 |   });
  111 | 
  112 |   test('response bodies are parsed, not string-concatenated', async ({ page }) => {
  113 |     const responseBodies: string[] = [];
  114 | 
  115 |     page.on('response', async (response) => {
  116 |       if (response.url().includes('/api/')) {
  117 |         try {
  118 |           const text = await response.text();
  119 |           responseBodies.push(text);
  120 |         } catch {
  121 |           // Some responses may not have body
  122 |         }
  123 |       }
  124 |     });
  125 | 
  126 |     await page.goto('/');
  127 |     await waitForInitialScreen(page);
  128 | 
  129 |     // Verify responses are valid JSON (not concatenated strings)
  130 |     for (const body of responseBodies) {
  131 |       if (body && body.trim()) {
  132 |         try {
  133 |           JSON.parse(body);
  134 |           // If we get here, it's valid JSON
  135 |         } catch {
  136 |           // Body should be valid JSON
  137 |           expect.fail(`Response body is not valid JSON: ${body.substring(0, 100)}`);
  138 |         }
  139 |       }
  140 |     }
  141 |   });
  142 | 
  143 |   test('form submission sends credentials, not hard-coded token', async ({ page }) => {
  144 |     let lastFormSubmission: any = null;
  145 | 
  146 |     page.on('request', (request) => {
  147 |       if (request.url().includes('/api/cache') && request.method() === 'POST') {
  148 |         request.postDataJSON().then((data) => {
  149 |           lastFormSubmission = data;
  150 |         }).catch(() => {
  151 |           // Some requests may not have JSON body
  152 |         });
  153 |       }
  154 |     });
  155 | 
  156 |     await page.goto('/');
  157 |     await waitForInitialScreen(page);
  158 | 
  159 |     const urlInput = page.locator(
  160 |       'input[placeholder*="Splunk URL"], input[placeholder*="MCP URL"]'
  161 |     ).first();
  162 |     const bodyText = (await page.textContent('body')) || '';
  163 |     const onConnectionScreen = bodyText.includes('Connect to Splunk');
  164 | 
  165 |     if (onConnectionScreen) {
  166 |       await expect(urlInput).toBeVisible();
  167 |     } else {
> 168 |       await expect(page.locator('text=datasensAI')).toBeVisible();
      |                                                     ^ Error: expect(locator).toBeVisible() failed
  169 |     }
  170 |   });
  171 | });
  172 | 
```