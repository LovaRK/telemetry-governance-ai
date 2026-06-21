import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const screenshotsDir = path.join(process.cwd(), 'test-screenshots');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = 'http://localhost:3002';

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
}

test.describe('All Tabs Audit', () => {
  test('Executive Overview tab - full scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Make sure Executive Overview is active
    await page.locator('text=EXECUTIVE OVERVIEW').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${screenshotsDir}/exec-01-top.png` });

    // Scroll through entire page
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${screenshotsDir}/exec-02-bottom.png` });
    await page.evaluate(() => window.scrollTo(0, 0));

    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });

  test('Telemetry Detail tab', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.locator('text=TELEMETRY DETAIL').first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotsDir}/telemetry-01.png` });

    // scroll down
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotsDir}/telemetry-02.png` });

    // Check no broken text
    const bodyText = await page.evaluate(() => document.body.innerText);
    const badPatterns = ['undefined', 'NaN', '[object Object]'];
    const found = badPatterns.filter(p => bodyText.includes(p));
    expect(found, `Bad patterns: ${found.join(', ')}`).toHaveLength(0);
    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });

  test('Governance tab', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.locator('text=GOVERNANCE').first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${screenshotsDir}/governance-01.png` });

    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotsDir}/governance-02.png` });

    const bodyText = await page.evaluate(() => document.body.innerText);
    const badPatterns = ['undefined', 'NaN', '[object Object]'];
    const found = badPatterns.filter(p => bodyText.includes(p));
    expect(found, `Bad patterns: ${found.join(', ')}`).toHaveLength(0);
    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });

  test('Settings page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotsDir}/settings-01.png` });

    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotsDir}/settings-02.png` });

    const bodyText = await page.evaluate(() => document.body.innerText);
    const badPatterns = ['undefined', 'NaN', '[object Object]'];
    const found = badPatterns.filter(p => bodyText.includes(p));
    expect(found, `Bad patterns: ${found.join(', ')}`).toHaveLength(0);
    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });

  test('Detail/Index drill-down page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(`${BASE_URL}/detail`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotsDir}/detail-01.png` });

    const bodyText = await page.evaluate(() => document.body.innerText);
    const badPatterns = ['undefined', 'NaN', '[object Object]'];
    const found = badPatterns.filter(p => bodyText.includes(p));
    expect(found, `Bad patterns: ${found.join(', ')}`).toHaveLength(0);
    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });
});
