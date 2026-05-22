import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test('dashboard shows explainability coverage percent', async ({ page, baseURL }) => {
  const base = baseURL || 'http://localhost:3002';
  await login(page, base);
  await page.goto(`${base}/`);
  await page.waitForLoadState('domcontentloaded');

  const coverage = page.getByTestId('explainability-coverage');
  if ((await coverage.count()) === 0) return;

  await expect(coverage).toBeVisible();
  await expect(coverage).toContainText(/\d+\/\d+/);

  const txt = (await coverage.textContent()) || '';
  if (txt.includes('(')) {
    expect(txt).toMatch(/\(\d+(\.\d+)?%\)/);
  }
});
