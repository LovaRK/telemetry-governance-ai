import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const screenshotsDir = path.join(process.cwd(), 'test-screenshots/opportunities');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = 'http://localhost:3002';

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  await page.waitForTimeout(1000);
}

test('Opportunities and Quick Wins visible', async ({ page }) => {
  await login(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: `${screenshotsDir}/01-executive-top.png` });

  const text = await page.evaluate(() => document.body.innerText);

  // Quick wins should NOT be 0
  expect(text).not.toMatch(/Quick Wins\s*0/);
  console.log('✅ Quick Wins is not 0');

  // S3 should not be 0
  expect(text).not.toMatch(/S3 Archive Candidates\s*0/);
  console.log('✅ S3 Candidates is not 0');

  // Top risk should show sourcetype names
  expect(text).toContain('darktrace');
  console.log('✅ Top Risk shows sourcetype names');

  // Scroll to savings staircase area
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/02-savings-staircase.png` });

  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/03-opportunities-section.png` });

  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${screenshotsDir}/04-tier-distribution.png` });
});
