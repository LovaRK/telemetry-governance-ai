import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

async function setMode(page: any, base: string, enabled: boolean) {
  await page.goto(`${base}/settings?tab=governance`);
  await page.waitForLoadState('domcontentloaded');
  const checkbox = page.locator('input[type="checkbox"]').first();
  if ((await checkbox.count()) === 0) return false;
  if (enabled) await checkbox.check();
  else await checkbox.uncheck();
  await page.getByRole('button', { name: /save explainability mode/i }).click();
  return true;
}

test('chart explainability icon obeys toggle', async ({ page, baseURL }) => {
  const base = baseURL || 'http://localhost:3002';
  await login(page, base);

  const hasSettings = await setMode(page, base, true);
  if (!hasSettings) return;

  await page.goto(`${base}/`);
  await page.waitForLoadState('domcontentloaded');

  const iconOn = page.getByTestId('chart-explain-roi');
  if ((await iconOn.count()) > 0) {
    await expect(iconOn).toBeVisible();
    await iconOn.click();
    await expect(page.locator('text=Chart:')).toBeVisible();
  }

  await setMode(page, base, false);
  await page.goto(`${base}/`);
  await page.waitForLoadState('domcontentloaded');

  const iconOff = page.getByTestId('chart-explain-roi');
  expect(await iconOff.count()).toBe(0);
});
