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
  timeout: 120000,  // 2 minutes per test
  expect: {
    timeout: 15000,  // 15 seconds for assertions
  },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,  // Reads from .env WEB_PORT
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 60000,  // 60 seconds for navigation
    actionTimeout: 30000,  // 30 seconds for actions
    headless: true,  // Keep CI/local runs non-interactive and predictable
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
