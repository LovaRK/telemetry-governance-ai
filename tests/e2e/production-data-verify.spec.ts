import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const screenshotsDir = path.join(process.cwd(), 'test-screenshots/production');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = 'http://localhost:3002';

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
}

test('Production data visible in dashboard', async ({ page }) => {
  await login(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: `${screenshotsDir}/01-executive-overview.png` });

  const text = await page.evaluate(() => document.body.innerText);

  // Verify 1stMile production data is showing
  expect(text).toContain('176');       // 176 sourcetypes
  console.log('✅ 176 sourcetypes visible');

  // Scroll to see KPI gauges
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/02-kpi-gauges.png` });

  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/03-kpi-trends.png` });

  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/04-tier-distribution.png` });

  // Check Telemetry Detail
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.locator('text=TELEMETRY DETAIL').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${screenshotsDir}/05-telemetry-detail.png` });
});
