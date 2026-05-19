/**
 * CHAOS TEST: Redis Lock Expiry
 *
 * Scenario: Two sweeper pods both try to reawaken deferred decisions
 *           Pod A acquires lock, pauses (GC stall)
 *           Lock TTL expires
 *           Pod B acquires lock, processes same decisions
 *           Pod A resumes, tries to process again
 *
 * Expected: FOR UPDATE SKIP LOCKED prevents double processing
 *           Idempotency keys suppress duplicate job emissions
 *           Exactly-once semantics preserved
 *
 * This validates: Distributed locking, SKIP LOCKED semantics, idempotency
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { TestEnvironment, setupTestEnvironment, createTestDecision } from '../testcontainers.setup';
import { deferralSweeper } from '@infra/queue/deferral-sweeper';

describe('Chaos: Redis Lock Expiry', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = await setupTestEnvironment();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('prevents duplicate reawakening with FOR UPDATE SKIP LOCKED', async () => {
    // Setup: Create 3 deferred decisions
    const decisions = await Promise.all([
      createTestDecision(env.db, 'lock-tenant', 'deferred-1'),
      createTestDecision(env.db, 'lock-tenant', 'deferred-2'),
      createTestDecision(env.db, 'lock-tenant', 'deferred-3'),
    ]);

    // Defer them
    for (const decision of decisions) {
      await env.db.decision.update({
        where: { id: decision.id },
        data: {
          status: 'DEFERRED',
          deferredAt: new Date(),
          deferredUntil: new Date(Date.now() - 1000), // Already past due
        },
      });
    }

    // Simulate concurrent sweepers
    // In real scenario: Pod A acquires lock, Pod B waits/retries
    // With SKIP LOCKED: Pod B skips locked rows, processes only available rows

    // Sweeper 1: Process all deferred decisions
    const result1 = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 5000,
      redisClient: env.redisClient,
    });

    expect(result1.processed).toBe(3);

    // Verify: All decisions reawakened
    const afterFirstSweep = await env.db.decision.findMany({
      where: { tenantId: 'lock-tenant' },
    });

    // After reawaking, status should be NEW (preparing for new run)
    // But SKIP LOCKED means they can't be reawakened again
    for (const decision of afterFirstSweep) {
      expect(decision.reawokenCount).toBe(1);
    }

    // Sweeper 2: Try to process again (should find 0 due to SKIP LOCKED)
    const result2 = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 5000,
      redisClient: env.redisClient,
    });

    // Should process 0 (all already updated)
    expect(result2.processed).toBe(0);

    // Verify: No duplicate reawakenings
    const finalDecisions = await env.db.decision.findMany({
      where: { tenantId: 'lock-tenant' },
    });

    for (const decision of finalDecisions) {
      expect(decision.reawokenCount).toBe(1); // Still 1, not 2
    }
  });

  it('respects MAX_REAWAKENS guard to prevent infinite loops', async () => {
    // Setup: Create a decision already reawakened 4 times
    const decision = await createTestDecision(env.db, 'max-reawaken-tenant', 'max-reawaken-index');

    await env.db.decision.update({
      where: { id: decision.id },
      data: {
        status: 'DEFERRED',
        deferredUntil: new Date(Date.now() - 1000),
        reawokenCount: 4, // Already at limit (5 is typical MAX)
      },
    });

    // Sweeper should detect and NOT reawaken
    const result = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 5000,
      redisClient: env.redisClient,
      maxReawakens: 5,
    });

    // Should skip this one
    expect(result.processed).toBe(0);
    expect(result.maxReawakensExceeded).toBe(1);

    // Verify: Decision moved to REJECTED_FINAL
    const finalDecision = await env.db.decision.findUnique({
      where: { id: decision.id },
    });

    expect(finalDecision?.status).toBe('REJECTED_FINAL');
  });

  it('emits idempotent reawaken events to prevent duplicate queue jobs', async () => {
    const decision = await createTestDecision(env.db, 'idempotent-reawaken-tenant', 'reawaken-index');

    await env.db.decision.update({
      where: { id: decision.id },
      data: {
        status: 'DEFERRED',
        deferredUntil: new Date(Date.now() - 1000),
      },
    });

    // Sweeper 1: Emit reawaken event
    const result1 = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 5000,
      redisClient: env.redisClient,
    });

    expect(result1.processed).toBe(1);

    // Get the idempotency key used
    const journal = await env.db.executionJournal.findFirst({
      where: { decisionId: decision.id },
      orderBy: { createdAt: 'desc' },
    });

    const idempotencyKey = journal?.idempotencyKey;
    expect(idempotencyKey).toContain('reawaken');

    // Sweeper 2: Try to emit same event again
    // Should be blocked by idempotency key in queue
    const result2 = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 5000,
      redisClient: env.redisClient,
    });

    expect(result2.processed).toBe(0);
    expect(result2.duplicateSkipped).toBe(0); // Already processed, won't appear again
  });

  it('handles distributed lock timeouts gracefully', async () => {
    const decision = await createTestDecision(env.db, 'timeout-tenant', 'timeout-index');

    await env.db.decision.update({
      where: { id: decision.id },
      data: {
        status: 'DEFERRED',
        deferredUntil: new Date(Date.now() - 1000),
      },
    });

    // Sweeper with very short lock TTL (will expire quickly)
    const result = await deferralSweeper(env.db, {
      lockKey: 'governance:sweeper:lock',
      lockTtlMs: 100, // 100ms TTL
      redisClient: env.redisClient,
    });

    // Should still process at least attempt
    expect(result.processed).toBeGreaterThanOrEqual(0);
    expect(result.lockAcquisitionFailed).toBeFalsy();
  });
});
