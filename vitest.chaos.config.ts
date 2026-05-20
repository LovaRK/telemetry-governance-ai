/**
 * VITEST CHAOS-INFRA CONFIG
 * Infrastructure-dependent chaos tests (requires Docker + Postgres + Redis + WireMock)
 *
 * Features:
 * - Testcontainers support (ephemeral containers)
 * - Extended timeouts for container startup/cleanup
 * - Detailed output for debugging container issues
 *
 * For pure invariant tests that don't require infrastructure:
 * Use vitest.chaos-invariants.config.ts instead
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Chaos tests need more time (container startup, network latency)
    testTimeout: 60000, // 60 seconds per test
    hookTimeout: 60000, // 60 seconds for setup/teardown
    teardownTimeout: 30000,

    // Run tests sequentially to avoid container conflicts
    threads: false,

    // Detailed output for debugging
    reporter: ['verbose'],
    outputFile: './test-results/chaos.junit.xml',

    // Environment
    environment: 'node',

    // Coverage (optional)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/core/workflow/executor-v2.ts',
        'packages/core/adapters/**/*.ts',
        'packages/infra/queue/reconciliation-worker.ts',
      ],
      exclude: [
        'node_modules/',
        'tests/',
      ],
    },

    // Globals (describe, it, expect without imports)
    globals: true,

    // Include pattern
    include: [
      'tests/chaos/scenarios/**/*.test.ts',
    ],
  },

  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './packages/core'),
      '@infra': path.resolve(__dirname, './packages/infra'),
    },
  },
});
