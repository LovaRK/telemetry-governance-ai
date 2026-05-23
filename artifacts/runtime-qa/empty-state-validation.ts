import { chromium } from 'playwright';

const BASE = 'http://localhost:3002';
const OUT = 'artifacts/runtime-qa/empty-state';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Test 1: No Splunk config → no fake data shown
  console.log('--- Test 1: No Splunk config, no fake data ---');
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('input[type="text"], input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 }),
    page.getByRole('button', { name: /login|sign in/i }).click(),
  ]);
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    localStorage.removeItem('splunk_config');
  });

  await page.unroute('**/api/cache-status**');
  await page.unroute('**/api/executive-summary**');

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  let bodyText = await page.textContent('body');
  let screenshot = `${OUT}/01-no-config.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  let hasFakeKpis = bodyText?.includes('totalSourcetypes') ?? false;
  let hasMockText = bodyText?.includes('mock') || bodyText?.includes('fabricated') ? true : false;

  console.log(`Fake KPIs: ${hasFakeKpis}`);
  console.log(`Mock/fabricated text: ${hasMockText}`);

  // When env vars are set, ConnectionGatedUI auto-populates config.
  // The key assertion: no fake/mock data regardless.
  const test1Pass = !hasFakeKpis && !hasMockText;

  // Test 2: hasEverRefreshed=false → connection screen (no fake data)
  console.log('\n--- Test 2: No refresh ever, connection screen ---');

  await page.route('**/api/cache-status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { hasEverRefreshed: false, hasData: false, hasAgentDecisions: false, hasKpis: false, status: 'idle', recordCount: 0, decisionCount: 0, message: 'Awaiting first refresh' },
        meta: { source: 'postgres' },
      }),
    });
  });
  await page.route('**/api/executive-summary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { summary: { totalSourcetypes: 0 }, indexes: [] },
        meta: { source: 'postgres' },
      }),
    });
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  bodyText = await page.textContent('body');
  screenshot = `${OUT}/02-no-refresh.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  let showsConnectToSplunk = bodyText?.includes('Connect to Splunk to get started') ?? false;
  hasFakeKpis = bodyText?.includes('totalSourcetypes') && !bodyText?.includes('totalSourcetypes: 0') ? true : false;
  hasMockText = bodyText?.includes('mock') || bodyText?.includes('fabricated') ? true : false;

  console.log(`'Connect to Splunk' shown: ${showsConnectToSplunk}`);
  console.log(`Fake KPIs: ${hasFakeKpis}`);
  console.log(`Mock/fabricated text: ${hasMockText}`);

  const test2Pass = showsConnectToSplunk && !hasFakeKpis && !hasMockText;

  // Test 3: Refresh done but no data → EmptyState component
  console.log('\n--- Test 3: Refresh done, no data, EmptyState ---');
  await page.route('**/api/cache-status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { hasEverRefreshed: true, hasData: false, hasAgentDecisions: false, hasKpis: false, status: 'idle', recordCount: 0, decisionCount: 0, message: 'No data from last refresh' },
        meta: { source: 'postgres' },
      }),
    });
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  bodyText = await page.textContent('body');
  screenshot = `${OUT}/03-refreshed-no-data.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  let showsEmptyState = bodyText?.includes('No Telemetry Data') ?? false;
  let showsRefreshButton = bodyText?.includes('Refresh from Splunk') ?? false;
  hasFakeKpis = bodyText?.includes('totalSourcetypes') && !bodyText?.includes('totalSourcetypes: 0') ? true : false;
  hasMockText = bodyText?.includes('mock') || bodyText?.includes('fabricated') ? true : false;

  console.log(`'No Telemetry Data' shown: ${showsEmptyState}`);
  console.log(`'Refresh from Splunk' shown: ${showsRefreshButton}`);
  console.log(`Fake KPIs: ${hasFakeKpis}`);
  console.log(`Mock/fabricated text: ${hasMockText}`);

  const test3Pass = showsEmptyState && showsRefreshButton && !hasFakeKpis && !hasMockText;

  // Summary
  console.log('\n=== EMPTY STATE VALIDATION SUMMARY ===');
  console.log(`Test 1 (no Splunk config): ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (has config, no refresh): ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 3 (refresh done, no data): ${test3Pass ? '✅ PASS' : '❌ FAIL'}`);

  const allPass = test1Pass && test2Pass && test3Pass;
  await browser.close();
  process.exit(allPass ? 0 : 1);
}

main();
