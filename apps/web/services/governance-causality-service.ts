/**
 * GovernanceCausalityService stub
 * Phase 6.1.5 — not yet implemented for demo
 * Routes import this; stub prevents build failure.
 */

import { Pool } from 'pg';

class GovernanceCausalityServiceClass {
  private pool: Pool | null = null;

  init(pool: Pool) {
    this.pool = pool;
  }

  async recordCacheCoherence(_data: Record<string, unknown>): Promise<void> {
    // Not yet implemented
  }

  async recordMutationLifecycle(_data: Record<string, unknown>): Promise<void> {
    // Not yet implemented
  }

  async authorizeReplay(_data: Record<string, unknown>): Promise<{ authorized: false; reason: string }> {
    return { authorized: false, reason: 'Replay authorization not yet implemented' };
  }

  async registerCorrelationContext(_data: Record<string, unknown>): Promise<{ correlationId: string }> {
    return { correlationId: `stub_${Date.now()}` };
  }
}

export const governanceCausalityService = new GovernanceCausalityServiceClass();
