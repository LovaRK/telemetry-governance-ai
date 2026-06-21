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

test.describe('Full Page Audit', () => {
  test('capture full dashboard with all sections', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message}`));

    await login(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000); // allow dashboard data to load

    // Full page screenshot
    await page.screenshot({ path: `${screenshotsDir}/full-dashboard-top.png`, fullPage: false });

    // Scroll down and capture sections
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${screenshotsDir}/full-dashboard-mid1.png` });

    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${screenshotsDir}/full-dashboard-mid2.png` });

    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${screenshotsDir}/full-dashboard-mid3.png` });

    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${screenshotsDir}/full-dashboard-bottom.png` });

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Click TELEMETRY DETAIL tab
    const telemetryTab = page.locator('text=TELEMETRY DETAIL').first();
    if (await telemetryTab.isVisible()) {
      await telemetryTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${screenshotsDir}/tab-telemetry-detail.png`, fullPage: false });
    }

    // Click GOVERNANCE tab
    const govTab = page.locator('text=GOVERNANCE').first();
    if (await govTab.isVisible()) {
      await govTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${screenshotsDir}/tab-governance.png`, fullPage: false });
    }

    // Report errors
    const criticalErrors = errors.filter(e => !e.includes('favicon') && !e.includes('hydration') && !e.includes('net::ERR'));
    console.log('All errors:', errors.length);
    console.log('Critical errors:', criticalErrors);

    // Check page text for bad values
    const pageText = await page.evaluate(() => document.body.innerText);
    const badPatterns = ['undefined', 'NaN', '[object Object]', 'FAILED_MODEL_UNAVAILABLE', 'Intelligence failed'];
    const found: string[] = [];
    for (const p of badPatterns) {
      if (pageText.includes(p)) found.push(p);
    }
    console.log('Bad patterns found:', found);

    expect(criticalErrors.length, `Critical errors: ${criticalErrors.join('; ')}`).toBe(0);
    expect(found, `Bad UI patterns found: ${found.join(', ')}`).toHaveLength(0);
  });
});
