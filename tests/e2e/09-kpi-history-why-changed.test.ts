import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test('kpi drawer shows why changed before/after evidence block', async ({ page, baseURL }) => {
  const base = baseURL || 'http://localhost:3002';
  await login(page, base);
  await page.goto(`${base}/`);
  await page.waitForLoadState('domcontentloaded');

  const coverage = page.getByTestId('explainability-coverage');
  if ((await coverage.count()) === 0) return;

  const buttons = page.getByRole('button');
  if ((await buttons.count()) === 0) return;
  await buttons.first().click();

  const why = page.getByTestId('why-changed');
  if ((await why.count()) === 0) return;
  await why.click();

  const block = page.getByTestId('kpi-history-block');
  await expect(block).toBeVisible();
  await expect(block).toContainText(/Before:/);
  await expect(block).toContainText(/After:/);
  await expect(block).toContainText(/Delta:/);
  await expect(block).toContainText(/Reason:/);
});
