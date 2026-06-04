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

test.describe('Settings & Detail Verification', () => {
  test('Settings - all 4 tabs', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Splunk Configuration (default)
    await page.screenshot({ path: `${screenshotsDir}/settings-splunk.png` });

    // AI / Governance tab
    const aiTab = page.locator('text=AI / Governance').first();
    if (await aiTab.isVisible()) {
      await aiTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${screenshotsDir}/settings-ai-governance.png` });
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotsDir}/settings-ai-governance-scroll.png` });
    }

    // User Settings tab
    const userTab = page.locator('text=User Settings').first();
    if (await userTab.isVisible()) {
      await userTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${screenshotsDir}/settings-user.png` });
    }

    // Scoring Weights tab
    const scoringTab = page.locator('text=Scoring Weights').first();
    if (await scoringTab.isVisible()) {
      await scoringTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${screenshotsDir}/settings-scoring.png` });
    }

    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });

  test('Detail page - confidence shows correct value (not 10000%)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(`${BASE_URL}/detail`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${screenshotsDir}/detail-kpi-fixed.png` });

    const bodyText = await page.evaluate(() => document.body.innerText);

    // Verify the confidence is NOT showing 10000%
    expect(bodyText).not.toContain('10000%');
    // Verify it shows a sensible value (100% is correct for 100 confidence)
    expect(bodyText).toContain('100%');

    console.log('Confidence check: 10000% NOT found ✅');
    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });

  test('Detail page - full scroll audit', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    await page.goto(`${BASE_URL}/detail`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${screenshotsDir}/detail-01-kpi-row.png` });
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotsDir}/detail-02-sourcetypes.png` });
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotsDir}/detail-03-gaps.png` });
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotsDir}/detail-04-bottom.png` });

    const bodyText = await page.evaluate(() => document.body.innerText);
    const badPatterns = ['undefined', 'NaN', '[object Object]', '10000%'];
    const found = badPatterns.filter(p => bodyText.includes(p));

    console.log('Bad patterns found:', found);
    expect(found, `Bad patterns: ${found.join(', ')}`).toHaveLength(0);
    expect(errors.length, `Page errors: ${errors.join('; ')}`).toBe(0);
  });
});
