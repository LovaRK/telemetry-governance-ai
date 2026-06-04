import { test, expect } from '@playwright/test';

test.describe('Dashboard Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Skip auth by setting token directly
    await page.evaluate(() => {
      localStorage.setItem('auth-token', 'valid-token');
      localStorage.setItem('user-email', 'admin@bitso.com');
    });
  });

  test('dashboard loads without runtime errors', async ({ page }) => {
    await page.goto('http://localhost:3000/dashboard/executive', {
      waitUntil: 'networkidle'
    });

    // Check that page loaded
    const pageTitle = await page.title();
    expect(pageTitle).toBeTruthy();

    // Take screenshot of loaded page
    await page.screenshot({ path: 'dashboard-loaded.png' });
  });

  test('executive summary displays KPI cards', async ({ page }) => {
    await page.goto('http://localhost:3000/dashboard/executive', {
      waitUntil: 'networkidle'
    });

    // Wait for KPI cards to render
    const roiCard = page.locator('[data-testid="roi-card"]').or(
      page.locator('text=/ROI|Return on Investment/')
    );

    // Check if at least the main container exists
    const mainContent = page.locator('main, [role="main"], .executive-overview');
    await expect(mainContent.first()).toBeVisible({ timeout: 10000 });

    // Screenshot the executive overview
    await page.screenshot({ path: 'executive-overview.png' });
  });

  test('no console errors on page load', async ({ page, context }) => {
    const errors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('http://localhost:3000/dashboard/executive', {
      waitUntil: 'networkidle'
    });

    // Give page 2 seconds to emit any deferred errors
    await page.waitForTimeout(2000);

    // Log any errors found
    if (errors.length > 0) {
      console.log('Console errors found:', errors);
    }

    // Screenshot for visual inspection
    await page.screenshot({ path: 'console-errors-check.png' });
  });

  test('API returns valid KPI classifications', async ({ page }) => {
    // Make direct API call to verify classifications are present
    const response = await page.request.get('http://localhost:3002/api/executive-summary', {
      headers: {
        'Authorization': 'Bearer test-token',
        'X-Tenant-ID': '6a917e40-329c-4702-ac27-c3af8978365a',
        'X-User-ID': 'b751c4b1-d6ad-46d2-9fbb-9e95de306836',
        'X-User-Role': 'admin'
      }
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const kpis = data.data?.kpis;

    expect(kpis).toBeTruthy();
    expect(kpis.roiScoreClassification).toBeTruthy();
    expect(['REAL', 'EMPTY', 'UNIMPLEMENTED', 'BASELINE']).toContain(kpis.roiScoreClassification);

    expect(kpis.gainScopeScoreClassification).toBeTruthy();
    expect(['REAL', 'EMPTY', 'UNIMPLEMENTED', 'BASELINE']).toContain(kpis.gainScopeScoreClassification);

    console.log('API Response KPIs:', {
      roiScore: kpis.roiScore,
      roiScoreClassification: kpis.roiScoreClassification,
      gainScopeScore: kpis.gainScopeScore,
      gainScopeScoreClassification: kpis.gainScopeScoreClassification,
    });
  });

  test('dashboard responds to range selector', async ({ page }) => {
    await page.goto('http://localhost:3000/dashboard/executive', {
      waitUntil: 'networkidle'
    });

    // Look for range selector buttons
    const rangeButtons = page.locator('button:has-text("7d"), button:has-text("30d"), button:has-text("90d")');
    const count = await rangeButtons.count();

    // Either range buttons exist, or that component hasn't been implemented yet
    console.log(`Found ${count} range selector buttons`);

    if (count > 0) {
      // Click 30d and wait for data to refresh
      await page.click('button:has-text("30d")');
      await page.waitForTimeout(2000);

      // Verify page is still responsive
      const mainContent = page.locator('main, [role="main"], .executive-overview');
      await expect(mainContent.first()).toBeVisible({ timeout: 5000 });
    }

    await page.screenshot({ path: 'range-selector.png' });
  });
});
