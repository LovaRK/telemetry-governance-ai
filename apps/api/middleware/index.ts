/**
 * Middleware Integration Index
 *
 * Wire all governance middleware into Express app
 */

import { Express } from 'express';
import { Pool } from 'pg';
import { governanceTraceMiddleware } from './governance-trace-middleware';
import { createGovernanceLifecycleRouter } from '../routes/governance-lifecycle';
import { createGovernanceTelemetryRouter } from '../routes/governance-telemetry';

/**
 * Install all governance middleware and routes
 * Call this in your main app.ts after creating the Express instance
 */
export function installGovernanceInstrumentation(app: Express, pool: Pool) {
  // Install middleware at the governance API boundary
  app.use('/api/governance', governanceTraceMiddleware);

  // Install route handlers with pool connection
  app.use('/api/governance/lifecycle', createGovernanceLifecycleRouter(pool));
  app.use('/api/governance/telemetry', createGovernanceTelemetryRouter(pool));

  console.log('✓ Governance instrumentation installed');
}

export { governanceTraceMiddleware };
