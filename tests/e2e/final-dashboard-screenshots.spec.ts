import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const screenshotsDir = path.join(process.cwd(), 'test-screenshots/final');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = 'http://localhost:3002';

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  await page.waitForTimeout(1500);
}

test('Full dashboard walkthrough', async ({ page }) => {
  await login(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Screenshot 1: Top — Opportunities, Risk, Detection Gaps
  await page.screenshot({ path: `${screenshotsDir}/01-top-panel.png` });

  // Screenshot 2: KPI gauges (ROI, GainScope, Spend, Savings)
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/02-kpi-gauges.png` });

  // Screenshot 3: KPI Trends
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/03-kpi-trends.png` });

  // Screenshot 4: Score Averages, Tier Distribution, Agent Actions
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/04-tier-distribution.png` });

  // Screenshot 5: Score Profile by Tier + Data Volume Split
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/05-score-profile.png` });

  // Screenshot 6: Annual License Spend by Tier + Savings Staircase
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/06-license-spend-staircase.png` });

  // Screenshot 7: Bottom
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/07-bottom.png` });

  // Telemetry Detail tab
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.locator('text=TELEMETRY DETAIL').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${screenshotsDir}/08-telemetry-detail.png` });

  // Scroll telemetry detail
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${screenshotsDir}/09-telemetry-detail-scroll.png` });
});
