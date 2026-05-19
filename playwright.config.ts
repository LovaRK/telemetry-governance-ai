import { defineConfig, devices } from '@playwright/test';

// Single source of truth for host port
const WEB_PORT = process.env.WEB_PORT || '3002';
const HEALTH_CHECK_ENABLED = process.env.HEALTH_CHECK_ENABLED !== 'false';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,  // Reads from .env WEB_PORT
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: undefined, // Use existing running server

  // Global setup: Wait for service health before running tests
  globalSetup: HEALTH_CHECK_ENABLED ? require.resolve('./tests/e2e/global.setup.ts') : undefined,
});
