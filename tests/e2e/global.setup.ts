/**
 * Global test setup for E2E tests
 *
 * Ensures all services are healthy before running tests.
 * This prevents race conditions where container starts but app isn't ready.
 */

import { execSync } from 'child_process';

const WEB_PORT = process.env.WEB_PORT || '3002';
const API_HEALTH_URL = `http://localhost:${WEB_PORT}/api/health`;
const MAX_RETRIES = 30;
const RETRY_INTERVAL_MS = 1000;

async function waitForService(url: string, retries = MAX_RETRIES): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { timeout: 5000 });
      if (response.ok) {
        console.log(`✅ Service healthy: ${url}`);
        return;
      }
    } catch {
      if (i === retries - 1) {
        throw new Error(
          `❌ Service not healthy after ${retries} retries: ${url}\n` +
          `Check: npm run dev is running and container is healthy`
        );
      }
      process.stdout.write('.');
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }
}

async function checkPortAvailability(port: number): Promise<boolean> {
  try {
    execSync(`lsof -i :${port} -t >/dev/null 2>&1`);
    return true; // Port is in use
  } catch {
    return false; // Port is available
  }
}

async function globalSetup(): Promise<void> {
  console.log(`\n🚀 E2E Test Global Setup`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Check if service is already running
  console.log(`\n📍 Checking service on http://localhost:${WEB_PORT}...`);
  const portInUse = await checkPortAvailability(Number(WEB_PORT));

  if (!portInUse) {
    throw new Error(
      `❌ Port ${WEB_PORT} is not in use.\n` +
      `Services are not running. Start them with: npm run dev`
    );
  }

  // Wait for service to be healthy
  console.log(`⏳ Waiting for service to be healthy...`);
  try {
    await waitForService(API_HEALTH_URL);
  } catch (error) {
    console.error(`\n${error}`);
    process.exit(1);
  }

  console.log(`✅ All services ready for testing`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

export default globalSetup;
