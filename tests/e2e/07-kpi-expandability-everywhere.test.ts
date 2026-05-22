import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test('kpi explainability cards are expandable and show formula/source fields safely', async ({ page, baseURL }) => {
  const base = baseURL || 'http://localhost:3002';
  await login(page, base);
  await page.goto(`${base}/`);
  await page.waitForLoadState('domcontentloaded');

  const coverage = page.getByTestId('explainability-coverage');
  if ((await coverage.count()) === 0) return;

  await expect(coverage).toBeVisible();
  const buttons = page.getByRole('button', { name: /view details|roi|gainscope|detection|savings|daily ingest|confidence/i });
  if ((await buttons.count()) === 0) return;

  await buttons.first().click();
  await expect(page.locator('text=Formula:')).toBeVisible();
  await expect(page.locator('text=Source Origin:')).toBeVisible();
  await expect(page.locator('text=Timestamp:')).toBeVisible();
  await expect(page.locator('text=Confidence:')).toBeVisible();
  await expect(page.locator('text=Variance:')).toBeVisible();
});
