import { expect, Page } from '@playwright/test';

export async function login(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/login`);
  await expect(page.locator('form')).toBeVisible({ timeout: 15_000 });

  await page.locator('input[type="email"], input[name="email"]').first().fill('admin@demo.local');
  await page.locator('input[type="password"], input[name="password"]').first().fill('Demo@12345');

  const submit = page.locator('button[type="submit"], form button').first();
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 }),
    submit.click(),
  ]);

  // Wait for page to stabilize, but don't fail if networkidle times out
  try {
    await page.waitForLoadState('networkidle', { timeout: 5_000 });
  } catch {
    // Network still busy, but that's ok - continue with tests
  }

  await expect(page.locator('body')).not.toContainText(/invalid credentials|unauthorized|login failed/i);
}
