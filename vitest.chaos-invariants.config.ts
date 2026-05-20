/**
 * VITEST CHAOS-INVARIANTS CONFIG
 * Pure invariant tests that do NOT require Docker/TestContainers
 *
 * These tests validate:
 * - L3: Route factory enforcement (createRoute, createStreamRoute)
 * - L4: Invariant health endpoint (trace attribution)
 * - L5: OPA policy decision binding (trace context, data purity)
 *
 * No external infrastructure required. All tests run in-memory.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Invariant tests should be fast (no container startup)
    testTimeout: 10000, // 10 seconds per test
    hookTimeout: 5000,
    teardownTimeout: 2000,

    // Run tests in parallel (no container conflicts)
    threads: true,

    // Reporter
    reporter: ['verbose'],
    outputFile: './test-results/chaos-invariants.junit.xml',

    // Environment
    environment: 'node',

    // Coverage (optional)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/core/policy/opa/evaluate-policy.ts',
        'packages/core/policy/opa/opa-client.ts',
        'packages/infra/observability/trace-context.ts',
        'apps/web/app/api/lib/create-route.ts',
        'apps/web/app/api/lib/create-stream-route.ts',
      ],
      exclude: [
        'node_modules/',
        '.next/',
      ],
    },

    // Globals
    globals: true,

    // Include only invariant tests (not infra tests)
    include: [
      'tests/chaos/invariants/**/*.test.ts',
    ],

    // Exclude infra tests
    exclude: [
      'tests/chaos/scenarios/**/*.test.ts',
      'node_modules',
    ],
  },

  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './packages/core'),
      '@infra': path.resolve(__dirname, './packages/infra'),
      '@api': path.resolve(__dirname, './apps/web/app/api'),
    },
  },
});
