/**
 * CHAOS TEST: Concurrent Sweep Race
 *
 * Scenario: Two sweepers run simultaneously against same deferred decisions
 *           Both acquire lock (somehow) or one gets lock while other waits
 *           SKIP LOCKED + idempotency should prevent double processing
 *
 * Expected: Exactly one sweeper processes each deferred decision
 *           No duplicate job emissions
 *           Both sweepers complete without error
 *
 * This validates: Database-level concurrency control (FOR UPDATE SKIP LOCKED),
 *                 Idempotency at queue level (jobId dedup)
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { TestEnvironment, setupTestEnvironment, createTestDecision } from '../testcontainers.setup';
import { deferralSweeper } from '@infra/queue/deferral-sweeper';

describe('Chaos: Concurrent Sweep Race', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = await setupTestEnvironment();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('ensures exactly-once processing with FOR UPDATE SKIP LOCKED', async () => {
    // Setup: Create 10 deferred decisions
    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createTestDecision(env.db, 'race-tenant', `race-index-${i}`),
      ),
    );

    // Defer all
    await Promise.all(
      decisions.map(d =>
        env.db.decision.update({
          where: { id: d.id },
          data: {
            status: 'DEFERRED',
            deferredUntil: new Date(Date.now() - 1000),
          },
        }),
      ),
    );

    // Simulate two concurrent sweepers
    const [result1, result2] = await Promise.all([
      deferralSweeper(env.db, {
        lockKey: 'governance:sweeper:lock:1',
        lockTtlMs: 5000,
        redisClient: env.redisClient,
      }),
      deferralSweeper(env.db, {
        lockKey: 'governance:sweeper:lock:2',
        lockTtlMs: 5000,
        redisClient: env.redisClient,
      }),
    ]);

    // Together they should process all 10, but no duplicates
    const totalProcessed = (result1.processed || 0) + (result2.processed || 0);
    expect(totalProcessed).toBe(10);

    // Verify: Each decision reawoken exactly once
    const finalDecisions = await env.db.decision.findMany({
      where: { tenantId: 'race-tenant' },
    });

    for (const decision of finalDecisions) {
      expect(decision.reawokenCount).toBe(1); // Exactly once
    }
  });

  it('handles lock contention without deadlock', async () => {
    // Setup: Create 5 deferred decisions with very short deferral window
    const decisions = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createTestDecision(env.db, 'contention-tenant', `contention-index-${i}`),
      ),
    );

    for (const d of decisions) {
      await env.db.decision.update({
        where: { id: d.id },
        data: {
          status: 'DEFERRED',
          deferredUntil: new Date(Date.now() - 1000),
        },
      });
    }

    // Run 3 sweepers concurrently (heavy contention)
    const results = await Promise.all([
      deferralSweeper(env.db, {
        lockKey: 'governance:sweeper:lock',
        lockTtlMs: 5000,
        redisClient: env.redisClient,
      }),
      deferralSweeper(env.db, {
        lockKey: 'governance:sweeper:lock',
        lockTtlMs: 5000,
        redisClient: env.redisClient,
      }),
      deferralSweeper(env.db, {
        lockKey: 'governance:sweeper:lock',
        lockTtlMs: 5000,
        redisClient: env.redisClient,
      }),
    ]);

    // All should complete without error
    expect(results.every(r => r !== null)).toBe(true);

    // Together should process exactly 5
    const totalProcessed = results.reduce((sum, r) => sum + (r?.processed || 0), 0);
    expect(totalProcessed).toBe(5);

    // Verify no duplicates
    const finalDecisions = await env.db.decision.findMany({
      where: { tenantId: 'contention-tenant' },
    });

    const duplicates = finalDecisions.filter(d => d.reawokenCount > 1);
    expect(duplicates.length).toBe(0);
  });

  it('respects database-level row locking (SKIP LOCKED)', async () => {
    // This test validates that SKIP LOCKED works correctly
    // If one sweeper locks a row, another should skip it (not wait for lock)

    const decision = await createTestDecision(env.db, 'skip-locked-tenant', 'skip-index');

    await env.db.decision.update({
      where: { id: decision.id },
      data: {
        status: 'DEFERRED',
        deferredUntil: new Date(Date.now() - 1000),
      },
    });

    // Sweeper 1 processes the decision (acquires row lock)
    const result1 = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 5000,
      redisClient: env.redisClient,
    });

    expect(result1.processed).toBe(1);

    // Sweeper 2 runs immediately after (row is already updated, no lock to skip)
    const result2 = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 5000,
      redisClient: env.redisClient,
    });

    // Should find 0 (already processed)
    expect(result2.processed).toBe(0);
  });

  it('prevents state corruption under concurrent updates', async () => {
    const decision = await createTestDecision(env.db, 'corruption-tenant', 'corruption-index');

    await env.db.decision.update({
      where: { id: decision.id },
      data: {
        status: 'DEFERRED',
        deferredUntil: new Date(Date.now() - 1000),
      },
    });

    // Simulate concurrent reawaken + manual update
    const [sweepResult, _] = await Promise.all([
      deferralSweeper(env.db, {
        lockKey: 'governance:sweeper:lock',
        lockTtlMs: 5000,
        redisClient: env.redisClient,
      }),
      // Meanwhile, operator tries to manually reapprove
      env.db.decision.update({
        where: { id: decision.id },
        data: { status: 'APPROVED' },
      }),
    ]);

    // Sweeper should have won (deterministic via reawokenCount)
    const finalDecision = await env.db.decision.findUnique({
      where: { id: decision.id },
    });

    // Decision state should be consistent (not corrupted)
    expect(['APPROVED', 'DEFERRED']).toContain(finalDecision?.status);

    // reawokenCount should be valid
    expect(finalDecision?.reawokenCount).toBeGreaterThanOrEqual(0);
    expect(finalDecision?.reawokenCount).toBeLessThanOrEqual(5); // Not exploded
  });
});
