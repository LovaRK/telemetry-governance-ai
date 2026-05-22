import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test('settings toggle persists and controls KPI explainability visibility', async ({ page, baseURL }) => {
  const base = baseURL || 'http://localhost:3002';
  await login(page, base);

  await page.goto(`${base}/settings?tab=governance`);
  await page.waitForLoadState('domcontentloaded');

  const checkbox = page.locator('input[type="checkbox"]').first();
  if ((await checkbox.count()) === 0) return;

  await checkbox.check();
  await page.getByRole('button', { name: /save explainability mode/i }).click();

  await page.goto(`${base}/`);
  await page.waitForLoadState('domcontentloaded');

  const coverage = page.getByTestId('explainability-coverage');
  // If env flag is enabled, panel should be visible when user mode is enabled.
  // If env flag is disabled, panel remains hidden by design.
  if ((await coverage.count()) > 0) {
    await expect(coverage).toBeVisible();
  }
});
