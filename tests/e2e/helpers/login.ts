import { expect, Page } from '@playwright/test';

export async function login(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/login`);
  await expect(page.locator('form')).toBeVisible({ timeout: 15_000 });

  // Use stable locators with actual credentials
  await page.locator('input[type="text"], input[type="email"]').first().fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');

  // Click login button and wait for navigation away from /login
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 }),
    page.getByRole('button', { name: /login|sign in/i }).click(),
  ]);

  // Wait for page to stabilize, but don't fail if networkidle times out
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    // Network still busy, but that's ok - continue with tests
  }

  await expect(page.locator('body')).not.toContainText(/invalid credentials|unauthorized|login failed/i);
}
