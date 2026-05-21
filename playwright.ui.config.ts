import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = process.env.WEB_PORT || '3002';

export default defineConfig({
  testDir: './tests/ui_mapping',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  timeout: 120000,
  expect: { timeout: 15000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: undefined,
});
