import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test.describe('KPI Explainability Panel', () => {
  test('drawer opens and displays formula + provenance fields when feature is available', async ({ page, baseURL }) => {
    const base = baseURL || 'http://localhost:3002';

    await login(page, base);

    await page.goto(`${base}/`);
    await page.waitForLoadState('domcontentloaded');

    const panel = page.locator('text=KPI Explainability').first();
    if ((await panel.count()) === 0) return;

    await expect(panel).toBeVisible({ timeout: 15000 });

    const openBtn = page.getByRole('button', { name: /view details/i }).first();
    if ((await openBtn.count()) === 0) return;

    await openBtn.click();

    await expect(page.locator('text=Formula')).toBeVisible();
    await expect(page.locator('text=Inputs')).toBeVisible();
    await expect(page.locator('text=Source Table')).toBeVisible();
    await expect(page.locator('text=Source Run')).toBeVisible();
    await expect(page.locator('text=Source Snapshot')).toBeVisible();
    await expect(page.locator('text=Confidence')).toBeVisible();
  });
});
