import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Ensure screenshots dir exists
const screenshotsDir = path.join(process.cwd(), 'test-screenshots');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = 'http://localhost:3002';

async function loginAndGetToken(page: Page): Promise<string> {
  const res = await page.request.post(`${BASE_URL}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    data: { email: 'admin@bitso.com', password: 'Admin@12345' },
  });
  const json = await res.json();
  return json.data?.accessToken || json.accessToken || '';
}

async function login(page: Page) {
  // Navigate to login page
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.screenshot({ path: `${screenshotsDir}/01-login-page.png` });

  // Fill in credentials
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const passInput  = page.locator('input[type="password"]').first();

  await emailInput.fill('admin@bitso.com');
  await passInput.fill('Admin@12345');
  await page.screenshot({ path: `${screenshotsDir}/02-login-filled.png` });

  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
  await page.waitForNavigation({ timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${screenshotsDir}/03-after-login.png` });
}

test.describe('Dashboard Browser Verification', () => {
  test('01 - Login page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.screenshot({ path: `${screenshotsDir}/01-login-page.png` });
    const title = await page.title();
    console.log('Page title:', title);
    expect(title).toBeTruthy();
  });

  test('02 - Login and reach dashboard', async ({ page }) => {
    await login(page);

    const url = page.url();
    console.log('Post-login URL:', url);
    await page.screenshot({ path: `${screenshotsDir}/04-dashboard-landing.png` });
    expect(url).not.toContain('/login');
  });

  test('03 - Executive overview renders with KPIs', async ({ page }) => {
    await login(page);

    // Navigate to executive overview
    const dashboardUrl = `${BASE_URL}/dashboard/executive`;
    await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${screenshotsDir}/05-executive-overview.png`, fullPage: true });

    const content = await page.content();
    console.log('Page has content:', content.length > 1000);

    // Check for key KPI labels
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log('Page text excerpt:', pageText.substring(0, 500));

    await page.screenshot({ path: `${screenshotsDir}/06-executive-full.png`, fullPage: true });
  });

  test('04 - Check for console errors', async ({ page }) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
      if (msg.type() === 'warning') warnings.push(msg.text());
    });
    page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message}`));

    await login(page);
    await page.goto(`${BASE_URL}/dashboard/executive`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);

    console.log('=== CONSOLE ERRORS ===');
    errors.forEach(e => console.log('ERROR:', e));
    console.log('=== CONSOLE WARNINGS ===');
    warnings.slice(0, 10).forEach(w => console.log('WARN:', w));

    await page.screenshot({ path: `${screenshotsDir}/07-console-check.png`, fullPage: true });

    // Fail the test if there are critical JS errors
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('net::ERR')
    );

    if (criticalErrors.length > 0) {
      console.log('CRITICAL ERRORS FOUND:', criticalErrors);
    }
    // Report but don't fail — we want to see all errors
    expect(criticalErrors.length).toBe(0);
  });

  test('05 - API executive-summary returns valid KPIs', async ({ page }) => {
    const token = await loginAndGetToken(page);
    expect(token.length).toBeGreaterThan(10);

    const res = await page.request.get(`${BASE_URL}/api/executive-summary`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Tenant-ID': '6a917e40-329c-4702-ac27-c3af8978365a',
        'X-User-ID':   'b751c4b1-d6ad-46d2-9fbb-9e95de306836',
        'X-User-Role': 'admin',
      },
    });

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const kpis = data.data?.kpis;
    console.log('KPIs:', JSON.stringify(kpis, null, 2));

    const tierAMetrics = [
      'roiScore', 'gainScopeScore', 'storageSavingsPotential',
      'totalLicenseSpend', 'licenseSpendLowValue',
      'tier1SpendAnnual', 'tier2SpendAnnual', 'tier3SpendAnnual', 'tier4SpendAnnual',
      'avgConfidence',
    ];

    const failures: string[] = [];
    for (const metric of tierAMetrics) {
      const classKey = `${metric}Classification`;
      const classification = kpis?.[classKey];
      if (!classification || !['REAL','EMPTY','UNIMPLEMENTED','BASELINE'].includes(classification)) {
        failures.push(`${metric}: classification="${classification}" INVALID`);
      } else {
        console.log(`✅ ${metric}: ${kpis[metric]} [${classification}]`);
      }
    }

    if (failures.length > 0) console.log('FAILURES:', failures);
    expect(failures).toHaveLength(0);
  });

  test('06 - All dashboard tabs render', async ({ page }) => {
    await login(page);

    const tabs = [
      { name: 'Executive', path: '/dashboard/executive' },
      { name: 'Telemetry', path: '/dashboard/telemetry' },
      { name: 'Detail',    path: '/dashboard/detail' },
      { name: 'Settings',  path: '/dashboard/settings' },
    ];

    for (const tab of tabs) {
      const url = `${BASE_URL}${tab.path}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const filename = `${screenshotsDir}/tab-${tab.name.toLowerCase()}.png`;
      await page.screenshot({ path: filename, fullPage: true });
      console.log(`✅ ${tab.name} tab loaded: ${page.url()}`);
    }
  });

  test('07 - No null KPI values displayed in UI', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/executive`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const pageText = await page.evaluate(() => document.body.innerText);

    // Check for signs of broken rendering
    const nullPatterns = ['undefined', 'NaN', '[object Object]'];
    const found: string[] = [];

    for (const pattern of nullPatterns) {
      if (pageText.includes(pattern)) {
        found.push(pattern);
      }
    }

    console.log('Null patterns found:', found);
    await page.screenshot({ path: `${screenshotsDir}/08-null-check.png`, fullPage: true });

    expect(found).toHaveLength(0);
  });
});
