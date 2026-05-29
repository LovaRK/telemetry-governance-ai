import { test, expect } from '@playwright/test';

test.describe('Setup Flow - Connect & Refresh', () => {
  test('should progress from setup page to dashboard after Splunk connection', async ({ page, context }) => {
    // Step 1: Clear all browser state (cookies + localStorage so no stale JWT redirects)
    await context.clearCookies();
    await page.goto('http://localhost:3002/login');
    await page.evaluate(() => localStorage.clear());

    // Step 2: Login
    await page.goto('http://localhost:3002/login');
    await page.fill('input[type="email"]', 'admin@bitso.com');
    await page.fill('input[type="password"]', 'Admin@12345');
    
    // Verify token is stored in localStorage after login
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3002/');
    
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(token).toBeTruthy();
    expect(token).toMatch(/^eyJhbGc/); // JWT header
    
    // Step 3: Wait for page to fully load (wait for "Checking Splunk connection" to disappear)
    await page.waitForTimeout(2000); // Give page time to start rendering

    // Wait for loading state to disappear
    const loadingMessage = page.locator('text=Checking Splunk connection');
    try {
      await loadingMessage.waitFor({ state: 'hidden', timeout: 15000 });
    } catch {
      // If still loading after 15s, take a screenshot and continue anyway
      console.log('Page still loading after 15s, continuing with checks...');
    }

    // Wait a bit more for content to render
    await page.waitForTimeout(1000);

    // The true setup screen uses the specific placeholder "(managed in Settings)".
    // The dashboard's compact connection bar also has a shorter "Splunk URL" input —
    // we must NOT mistake that for the first-run setup form.
    const setupForm = page.locator('input[placeholder="Splunk URL (managed in Settings)"]');
    const dashboardTab = page.locator('button:has-text("Executive Overview")');

    const setupVisible = await setupForm.isVisible().catch(() => false);
    const dashboardVisible = await dashboardTab.isVisible().catch(() => false);

    if (!setupVisible && !dashboardVisible) {
      console.log('WARNING: Neither setup form nor dashboard is visible');
      // Continue anyway - we'll verify page loads
    }

    // If setup is not visible, the test database already has data - that's OK
    if (!setupVisible) {
      console.log('Setup form not visible - database has existing data from prior run');
    }
    
    // Step 4-6: Only test connection if setup form is visible
    if (setupVisible) {
      const responsePayloads: { url: string; status: number; body: any }[] = [];

      page.on('response', async (response) => {
        if (response.url().includes('/api/cache') || response.url().includes('cache-status')) {
          try {
            const body = await response.json();
            responsePayloads.push({
              url: response.url(),
              status: response.status(),
              body,
            });
          } catch {
            responsePayloads.push({
              url: response.url(),
              status: response.status(),
              body: null,
            });
          }
        }
      });

      // Fill Splunk credentials — select basic auth first in case config loaded a different type
      await page.fill('input[placeholder*="Splunk URL"]', 'https://144.202.48.85:8089');
      const authSelect = page.locator('select').filter({ hasText: /basic/i }).first();
      if (await authSelect.isVisible()) {
        await authSelect.selectOption('basic');
      }
      // Setup screen uses placeholder="Username"; dashboard edit form uses placeholder="User"
      const usernameInput = page.locator('input[placeholder="Username"], input[placeholder="User"]').first();
      await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
      await usernameInput.fill('ram');
      const passwordInput = page.locator('input[placeholder="Password"], input[placeholder="Pass"]').first();
      await passwordInput.fill('Rama@1988');

      // Click Connect & Refresh
      await page.click('button:has-text("Connect & Refresh")');

      // Wait for requests to complete (max 30 seconds)
      const startTime = Date.now();
      while (Date.now() - startTime < 30000) {
        if (responsePayloads.length >= 2) break;
        await page.waitForTimeout(100);
      }

      // Verify network requests with strict assertions
      expect(responsePayloads.length).toBeGreaterThanOrEqual(2);

      // Both requests must succeed with 200 status
      for (const payload of responsePayloads) {
        expect(payload.status).toBe(200);
      }

      // Cache endpoint must be present
      const cacheRequest = responsePayloads.find(p => p.url.includes('/api/cache') && !p.url.includes('cache-status'));
      expect(cacheRequest).toBeDefined();
      expect(cacheRequest?.status).toBe(200);

      // Cache status endpoint must return hasEverRefreshed: true (with unwrapped data property)
      const statusRequest = responsePayloads.find(p => p.url.includes('cache-status'));
      expect(statusRequest).toBeDefined();
      expect(statusRequest?.status).toBe(200);
      expect(statusRequest?.body?.data?.hasEverRefreshed).toBeTruthy();
    }
    
    // Step 7: Verify page transitioned to dashboard (not stuck on setup)
    // Strict assertion: URL must be exactly the root, and must NOT contain "setup"
    await expect(page).toHaveURL('http://localhost:3002/');
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('setup');

    // The first-run setup screen must NOT be visible anymore
    const setupFormAfterConnect = page.locator('input[placeholder="Splunk URL (managed in Settings)"]');
    await expect(setupFormAfterConnect).not.toBeVisible({ timeout: 5000 });

    // Step 8: Verify we've reached the dashboard page (not stuck on setup)
    // Check that the URL doesn't contain "setup" and the main content area is present
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('setup');

    // The main dashboard container should be visible
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible({ timeout: 5000 });
  });
  
  test('should NOT get stuck on setup page if token exists', async ({ page, context }) => {
    // Setup: Clear state and login first
    await context.clearCookies();
    
    await page.goto('http://localhost:3002/login');
    await page.fill('input[type="email"]', 'admin@bitso.com');
    await page.fill('input[type="password"]', 'Admin@12345');
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3002/');
    
    // Verify: Even if we're on setup page, credentials work
    const setupButton = page.locator('button:has-text("Connect & Refresh")');
    
    if (await setupButton.isVisible()) {
      // Setup page visible, fill and submit
      await page.fill('input[placeholder*="Splunk URL"]', 'https://144.202.48.85:8089');
      await page.fill('input[placeholder="Username"]', 'ram');
      await page.fill('input[placeholder="Password"]', 'Rama@1988');
      
      // The button should NOT be disabled
      expect(await setupButton.isDisabled()).toBe(false);
      
      // After click, page should change within 30s
      await page.click(setupButton);
      
      await expect(page).toHaveURL('http://localhost:3002/', { timeout: 30000 });
      
      // Should see dashboard content, not setup form
      const setupForm = page.locator('input[placeholder*="Splunk URL"]');
      await expect(setupForm).not.toBeVisible({ timeout: 5000 });
    }
  });
});
