import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const screenshotsDir = path.join(process.cwd(), 'test-screenshots/settings-ai');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = 'http://localhost:3002';

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.locator('button[type="submit"]').first().click();
  // Wait for redirect away from login page
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  await page.waitForTimeout(1000);
}

test('Settings AI - 3-way mode selector renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await login(page);
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Click AI / Governance tab
  await page.locator('text=AI / Governance').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${screenshotsDir}/01-ai-tab-local-only.png` });

  const text = await page.evaluate(() => document.body.innerText);

  // Verify 3 mode options present
  expect(text).toContain('Local Only');
  expect(text).toContain('Local → Anthropic Fallback');
  expect(text).toContain('Anthropic Only');
  console.log('✅ All 3 AI modes visible');

  // Verify Anthropic section is HIDDEN when Local Only is selected
  expect(text).not.toContain('Anthropic API Configuration');
  console.log('✅ Anthropic section hidden in Local Only mode');

  // Click "Local → Anthropic Fallback"
  await page.locator('text=Local → Anthropic Fallback').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/02-ai-tab-fallback-mode.png` });

  const textFallback = await page.evaluate(() => document.body.innerText);
  expect(textFallback).toContain('Anthropic API Configuration');
  expect(textFallback).toContain('Anthropic API Key');
  expect(textFallback).toContain('Test Anthropic Connection');
  console.log('✅ Anthropic section visible in fallback mode');

  // Click "Anthropic Only"
  await page.locator('text=Anthropic Only').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${screenshotsDir}/03-ai-tab-anthropic-only.png` });

  expect(errors.length, `Errors: ${errors.join('; ')}`).toBe(0);
});

test('Settings AI - Save local_only (no key required)', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('text=AI / Governance').first().click();
  await page.waitForTimeout(1000);

  // Make sure Local Only is selected (default)
  await page.locator('input[value="local_only"]').first().check();
  await page.waitForTimeout(500);

  // Click Save
  await page.locator('text=Save AI Settings').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${screenshotsDir}/04-save-local-only.png` });

  const text = await page.evaluate(() => document.body.innerText);
  expect(text).toContain('AI settings saved');
  console.log('✅ Local Only saved without requiring API key');
});
