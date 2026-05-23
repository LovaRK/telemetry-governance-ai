import { test, expect } from '@playwright/test';

test('release certification: no governance API 500s on navigation', async ({ page }) => {
  const failures: string[] = [];

  page.on('response', (r) => {
    const url = r.url();
    if (url.includes('/api/') && r.status() >= 500 && !url.includes('/test-connection')) {
      failures.push(`${r.status()} ${url}`);
    }
  });

  await page.goto('/login?next=%2F');
  await page.locator('input[type="email"]').fill('admin@bitso.com');
  await page.locator('input[type="password"]').first().fill('Admin@12345');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/', { timeout: 30000 });

  await page.getByRole('button', { name: /Executive Overview/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Telemetry Detail/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Governance/i }).click();
  await page.waitForTimeout(3000);

  expect(failures).toEqual([]);
});
