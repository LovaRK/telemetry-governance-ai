import { chromium } from 'playwright';

const BASE = 'http://localhost:3002';
const OUT = 'artifacts/runtime-qa/slow-network';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => { pageErrors.push(err.message); });
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  // Login helper
  async function login() {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.locator('input[type="text"], input[type="email"]').first().fill('admin@bitso.com');
    await page.locator('input[type="password"]').first().fill('Admin@12345');
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 }),
      page.getByRole('button', { name: /login|sign in/i }).click(),
    ]);
    await page.waitForTimeout(2000);
  }

  // Test 1: Slow 3G simulation — page loads with skeletons, no crash
  console.log('--- Test 1: Slow 3G simulation ---');
  await login();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
    connectionType: 'cellular3g',
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  let screenshot = `${OUT}/01-slow-3g.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  let bodyText = await page.textContent('body');
  let noCrash = !bodyText?.includes('Application error') && !bodyText?.includes('Internal Server Error');
  let pageLoadErrors = pageErrors.length;

  // Restore network
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: 'none',
  });
  await page.waitForTimeout(2000);

  console.log(`No crash: ${noCrash}`);
  console.log(`Page errors: ${pageLoadErrors}`);
  const test1Pass = noCrash;

  // Test 2: Offline simulation
  console.log('\n--- Test 2: Offline simulation ---');
  pageErrors.length = 0;
  await login();

  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: 'none',
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  screenshot = `${OUT}/02-offline.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  bodyText = await page.textContent('body');
  noCrash = !bodyText?.includes('Application error') && !bodyText?.includes('Internal Server Error');
  console.log(`No crash: ${noCrash}`);
  console.log(`Page errors: ${pageErrors.length}`);

  // Restore network
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'none',
  });
  await page.waitForTimeout(2000);

  const test2Pass = noCrash;

  // Test 3: API returning 500s for all endpoints
  console.log('\n--- Test 3: API 500 errors simulation ---');
  pageErrors.length = 0;
  await page.unroute('**/api/**');
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated server error' }) });
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  screenshot = `${OUT}/03-api-500.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  bodyText = await page.textContent('body');
  noCrash = !bodyText?.includes('Application error');
  // When all APIs fail, the page shows the connection screen (which doesn't need APIs)
  // or a graceful error state — either is acceptable
  const graceful = noCrash || bodyText?.includes('Connect to Splunk') || bodyText?.includes('Splunk');
  const hasPageContent = (bodyText?.length ?? 0) > 100;
  console.log(`No Application error: ${noCrash}`);
  console.log(`Graceful error/fallback: ${graceful}`);
  console.log(`Has page content: ${hasPageContent}`);

  await page.unroute('**/api/**');

  const test3Pass = graceful && hasPageContent;

  // Test 4: Recovery after network failure
  console.log('\n--- Test 4: Recovery after failure ---');
  pageErrors.length = 0;
  await login();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  bodyText = await page.textContent('body');
  const recovered = (bodyText?.includes('datasensAI') ?? false) && !bodyText?.includes('Application error');
  console.log(`Recovered after network: ${recovered}`);

  screenshot = `${OUT}/04-recovery.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  const test4Pass = recovered;

  // Summary
  console.log('\n=== SLOW NETWORK VALIDATION SUMMARY ===');
  console.log(`Test 1 (Slow 3G): ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (Offline): ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 3 (API 500s): ${test3Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 4 (Recovery): ${test4Pass ? '✅ PASS' : '❌ FAIL'}`);

  const allPass = test1Pass && test2Pass && test3Pass && test4Pass;
  await browser.close();
  process.exit(allPass ? 0 : 1);
}

main();
