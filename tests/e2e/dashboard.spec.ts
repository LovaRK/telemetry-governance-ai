import { test, expect } from '@playwright/test';

test('dashboard loads and tab navigation works', async ({ page }) => {
  await page.goto('/login?next=%2F');
  await page.locator('input[type="email"]').fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.waitForURL('**/', { timeout: 30000 });
  await expect(page.locator('text=datasensAI')).toBeVisible();

  await page.getByRole('button', { name: /Telemetry Detail/i }).click();
  await expect(page.locator('text=TELEMETRY INTELLIGENCE')).toBeVisible();

  await page.getByRole('button', { name: /Governance/i }).click();
  await expect(page.locator('text=Live Cache Coherence')).toBeVisible();
});
