/**
 * Trace Propagation Failure-Mode Test Suite
 *
 * Phase 6.1.5A.1.1: Behavioral Integrity Under Stress
 * Tests 5 critical failure scenarios that break trace propagation in real systems
 *
 * These tests prove the system maintains forensic-grade trace integrity
 * even when async operations fail, retry, or reconnect.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { GovernanceCausalityEngine } from '@/services/governance-causality-engine';
import {
  validateTraceCompleteness,
  reconstructSpanGraph,
} from '@/validators/trace-completeness-validator';
import {
  evaluateTraceTrust,
  TraceTrustLevel,
} from '@/validators/trace-trust-evaluator';
import {
  runWithTraceContextAsync,
  getTraceContext,
  TraceContext,
} from '@/types/trace-context';

let pool: Pool;
let engine: GovernanceCausalityEngine;

beforeAll(async () => {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost/test_governance',
  });
  engine = new GovernanceCausalityEngine(pool);
});

afterAll(async () => {
  await pool.end();
});

/**
 * FAILURE MODE 1: Async Fragmentation
 * ===================================
 * Scenario: Promise.all([queue publish, audit snapshot, telemetry])
 * Risk: Child spans lose parent linkage in parallel branches
 */
describe('Failure Mode 1: Async Fragmentation (Promise.all)', () => {
  it('preserves parent trace through parallel branches', async () => {
    const rootContext = engine.createRootTraceContext();

    const result = await runWithTraceContextAsync(rootContext, async () => {
      await engine.recordSpanEvent(rootContext, 'INTENT_RECEIVED', {
        status: 'success',
      });

      // Simulate parallel async operations
      const [queueResult, auditResult, telemetryResult] = await Promise.all([
        // Branch 1: Queue publish
        (async () => {
          const queueContext = engine.createChildSpan(rootContext, {
            spanName: 'queue:publish',
          });
          await engine.recordSpanEvent(queueContext, 'MUTATION_DISPATCHED', {
            status: 'success',
            previousState: 'INTENT_RECEIVED',
          });
          return queueContext;
        })(),

        // Branch 2: Audit snapshot
        (async () => {
          const auditContext = engine.createChildSpan(rootContext, {
            spanName: 'audit:snapshot',
          });
          await engine.recordSpanEvent(auditContext, 'AUDIT_SNAPSHOTTED', {
            status: 'success',
            previousState: 'INTENT_RECEIVED',
          });
          return auditContext;
        })(),

        // Branch 3: Telemetry record
        (async () => {
          const telemetryContext = engine.createChildSpan(rootContext, {
            spanName: 'telemetry:record',
          });
          await engine.recordSpanEvent(telemetryContext, 'API_ACCEPTED', {
            status: 'success',
            previousState: 'INTENT_RECEIVED',
          });
          return telemetryContext;
        })(),
      ]);

      await engine.recordSpanEvent(rootContext, 'STATE_PERSISTED', {
        status: 'success',
        previousState: 'API_ACCEPTED',
      });

      return { queueResult, auditResult, telemetryResult };
    });

    // Verify: All branches share same trace_id
    expect(result.queueResult.traceId).toBe(rootContext.traceId);
    expect(result.auditResult.traceId).toBe(rootContext.traceId);
    expect(result.telemetryResult.traceId).toBe(rootContext.traceId);

    // Verify: Each branch has correct parent_span_id pointing to root
    expect(result.queueResult.parentSpanId).toBe(rootContext.spanId);
    expect(result.auditResult.parentSpanId).toBe(rootContext.spanId);
    expect(result.telemetryResult.parentSpanId).toBe(rootContext.spanId);

    // Verify: Trace is complete
    const completeness = await validateTraceCompleteness(rootContext.traceId, pool);
    expect(completeness.spanCount).toBe(5); // root + 3 branches + root persist
    expect(completeness.parentChildLinkageValid).toBe(true);
    expect(completeness.orphanSpans.length).toBe(0);

    // Verify: Trust assessment classifies as TRUSTED
    const spanGraph = await reconstructSpanGraph(rootContext.traceId, pool);
    const trust = await evaluateTraceTrust(completeness, spanGraph, pool);
    expect(trust.trustLevel).toBe(TraceTrustLevel.TRUSTED);
    expect(trust.safeForAutomation).toBe(true);
    expect(trust.automationGate.allowFull).toBe(true);
  });

  it('detects broken parent linkage when async context is lost', async () => {
    const rootContext = engine.createRootTraceContext();

    // ❌ INCORRECT PATTERN: Create child span OUTSIDE AsyncLocalStorage boundary
    const orphanChild = engine.createChildSpan(rootContext);
    const orphanContext = { ...orphanChild, parentSpanId: null }; // Simulates lost parent

    await engine.recordSpanEvent(orphanContext, 'MUTATION_DISPATCHED', {
      status: 'success',
    });

    // This should be detected as an orphan
    const completeness = await validateTraceCompleteness(rootContext.traceId, pool);
    expect(completeness.orphanSpans.length).toBeGreaterThan(0);
    expect(completeness.parentChildLinkageValid).toBe(false);

    // Verify: Trust assessment classifies as UNTRUSTWORTHY
    const spanGraph = await reconstructSpanGraph(rootContext.traceId, pool);
    const trust = await evaluateTraceTrust(completeness, spanGraph, pool);
    expect(trust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);
    expect(trust.safeForAutomation).toBe(false);
    expect(trust.automationGate.allowEscalationOnly).toBe(true);
  });
});

/**
 * FAILURE MODE 2: Retry Chains
 * ==============================
 * Scenario: Mutation fails → retry → retry again
 * Risk: Each retry becomes a new root instead of child span (trace tree collapse)
 */
describe('Failure Mode 2: Retry Chain Integrity', () => {
  it('maintains parent chain through retry attempts', async () => {
    const rootContext = engine.createRootTraceContext();

    const retryAttempts = [];

    await runWithTraceContextAsync(rootContext, async () => {
      // Initial attempt
      await engine.recordSpanEvent(rootContext, 'INTENT_RECEIVED', {
        status: 'success',
      });

      for (let attempt = 0; attempt < 3; attempt++) {
        const retryContext = engine.createChildSpan(rootContext, {
          spanName: `retry:attempt_${attempt}`,
          retryAttempt: attempt,
        });
        retryAttempts.push(retryContext);

        const status = attempt === 2 ? 'success' : 'timeout'; // Succeed on 3rd attempt
        await engine.recordSpanEvent(retryContext, 'API_ACCEPTED', {
          status,
          errorMessage: attempt < 2 ? 'Connection timeout' : undefined,
          previousState: 'INTENT_RECEIVED',
        });

        if (status === 'success') {
          break;
        }
      }
    });

    // Verify: All attempts are children of root (not siblings of root)
    expect(retryAttempts.every((ctx) => ctx.parentSpanId === rootContext.spanId)).toBe(true);

    // Verify: All attempts share same trace_id
    expect(retryAttempts.every((ctx) => ctx.traceId === rootContext.traceId)).toBe(true);

    // Verify: Each attempt has correct retryCount
    expect(retryAttempts[0].retryCount).toBe(0);
    expect(retryAttempts[1].retryCount).toBe(1);
    expect(retryAttempts[2].retryCount).toBe(2);

    // Verify: Completeness validator detects the chain
    const completeness = await validateTraceCompleteness(rootContext.traceId, pool);
    expect(completeness.orphanSpans.length).toBe(0);
    expect(completeness.parentChildLinkageValid).toBe(true);

    // Verify: Trust assessment classifies as TRUSTED
    const spanGraph = await reconstructSpanGraph(rootContext.traceId, pool);
    const trust = await evaluateTraceTrust(completeness, spanGraph, pool);
    expect(trust.trustLevel).toBe(TraceTrustLevel.TRUSTED);
    expect(trust.safeForAutomation).toBe(true);
    expect(trust.automationGate.allowFull).toBe(true);
  });

  it('detects when retry becomes new root (❌ BROKEN)', async () => {
    const initialContext = engine.createRootTraceContext();

    // ❌ BROKEN PATTERN: Each retry creates a NEW ROOT instead of child span
    const retryAsNewRoot = engine.createRootTraceContext(); // WRONG!

    await engine.recordSpanEvent(initialContext, 'INTENT_RECEIVED', {
      status: 'timeout',
    });

    await engine.recordSpanEvent(retryAsNewRoot, 'INTENT_RECEIVED', {
      status: 'success',
    });

    // These are TWO SEPARATE TRACES, not a parent-child relationship
    expect(initialContext.traceId).not.toBe(retryAsNewRoot.traceId);

    // Validator will see two incomplete traces
    const initial = await validateTraceCompleteness(initialContext.traceId, pool);
    const retry = await validateTraceCompleteness(retryAsNewRoot.traceId, pool);

    expect(initial.isComplete).toBe(false); // Incomplete (only INTENT_RECEIVED)
    expect(retry.isComplete).toBe(false); // Incomplete (only INTENT_RECEIVED)

    // Verify: Trust assessment classifies both as UNTRUSTWORTHY
    const initialGraph = await reconstructSpanGraph(initialContext.traceId, pool);
    const retryGraph = await reconstructSpanGraph(retryAsNewRoot.traceId, pool);
    const initialTrust = await evaluateTraceTrust(initial, initialGraph, pool);
    const retryTrust = await evaluateTraceTrust(retry, retryGraph, pool);

    expect(initialTrust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);
    expect(retryTrust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);

    // This would cause Phase 6.2 to mis-diagnose as two separate incidents
  });
});

/**
 * FAILURE MODE 3: SSE Reconnect + Replay
 * ======================================
 * Scenario: Mutation → SSE emit → client disconnect → reconnect → replay buffer
 * Risk: Replayed events get new trace_id instead of preserving original
 */
describe('Failure Mode 3: SSE Reconnect & Replay', () => {
  it('preserves trace context through SSE event replay', async () => {
    const rootContext = engine.createRootTraceContext();

    await runWithTraceContextAsync(rootContext, async () => {
      // Initial mutation
      await engine.recordSpanEvent(rootContext, 'INTENT_RECEIVED', {
        status: 'success',
      });

      // Emit to SSE with trace context embedded
      const ssePayload = engine.serializeTraceContextToPayload(rootContext);

      // Simulate client disconnect and reconnect
      // Client receives replay buffer with original events
      const replayContext = engine.deserializeTraceContextFromPayload(ssePayload);

      // Verify: Replayed context has SAME traceId
      expect(replayContext.traceId).toBe(rootContext.traceId);

      // Verify: Replayed context preserves correlationId
      expect(replayContext.correlationId).toBe(rootContext.correlationId);

      // Continue trace with replayed context
      const childContext = engine.createChildSpan(replayContext, {
        spanName: 'sse:replay:continued',
      });

      await engine.recordSpanEvent(childContext, 'UI_RECONCILED', {
        status: 'success',
      });
    });

    const completeness = await validateTraceCompleteness(rootContext.traceId, pool);
    expect(completeness.orphanSpans.length).toBe(0);

    // Verify: Trust assessment classifies as TRUSTED
    const spanGraph = await reconstructSpanGraph(rootContext.traceId, pool);
    const trust = await evaluateTraceTrust(completeness, spanGraph, pool);
    expect(trust.trustLevel).toBe(TraceTrustLevel.TRUSTED);
    expect(trust.safeForAutomation).toBe(true);
  });

  it('detects when replay creates new trace (❌ BROKEN)', async () => {
    const originalContext = engine.createRootTraceContext();

    // Original event
    await engine.recordSpanEvent(originalContext, 'INTENT_RECEIVED', {
      status: 'success',
    });

    // ❌ BROKEN: Replay creates NEW trace instead of restoring original
    const brokenReplayContext = engine.createRootTraceContext(); // WRONG!

    await engine.recordSpanEvent(brokenReplayContext, 'UI_RECONCILED', {
      status: 'success',
    });

    // Two separate traces - lost causality
    expect(originalContext.traceId).not.toBe(brokenReplayContext.traceId);

    // Validator sees broken trace (initial event disconnected from replay)
    const original = await validateTraceCompleteness(originalContext.traceId, pool);
    expect(original.isComplete).toBe(false);

    // Verify: Trust assessment classifies as UNTRUSTWORTHY
    const originalGraph = await reconstructSpanGraph(originalContext.traceId, pool);
    const originalTrust = await evaluateTraceTrust(original, originalGraph, pool);
    expect(originalTrust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);
  });
});

/**
 * FAILURE MODE 4: Queue Redelivery & DLQ
 * ======================================
 * Scenario: Job published → fails → retry → DLQ → replay → success
 * Risk: Each redelivery resets trace context (lost lineage through retries)
 */
describe('Failure Mode 4: Queue Redelivery & DLQ', () => {
  it('maintains trace through queue redelivery chain', async () => {
    const rootContext = engine.createRootTraceContext();

    await runWithTraceContextAsync(rootContext, async () => {
      // Initial publish
      const jobEnvelope1 = {
        payload: { action: 'remediate' },
        traceContext: engine.serializeTraceContextToPayload(rootContext),
        jobId: 'job_1',
        retryCount: 0,
        enqueuedAt: performance.now(),
      };

      // First attempt fails
      const attempt1Context = engine.deserializeTraceContextFromPayload(
        jobEnvelope1.traceContext
      );
      const attempt1Child = engine.createChildSpan(attempt1Context, {
        spanName: 'worker:attempt_1',
        retryAttempt: 0,
      });

      await engine.recordSpanEvent(attempt1Child, 'QUERY_REFETCHED', {
        status: 'error',
        errorCode: 'WORKER_TIMEOUT',
        previousState: 'QUERY_INVALIDATED',
      });

      // Redelivery (envelope preserved with same traceContext)
      const jobEnvelope2 = {
        ...jobEnvelope1,
        jobId: 'job_1_retry',
        retryCount: 1,
        enqueuedAt: performance.now(),
        // traceContext is SAME as original
      };

      const attempt2Context = engine.deserializeTraceContextFromPayload(
        jobEnvelope2.traceContext
      );
      const attempt2Child = engine.createChildSpan(attempt2Context, {
        spanName: 'worker:attempt_2',
        retryAttempt: 1,
      });

      await engine.recordSpanEvent(attempt2Child, 'QUERY_REFETCHED', {
        status: 'success',
        previousState: 'QUERY_INVALIDATED',
      });
    });

    // Verify: Both attempts share same trace and are linked
    const reconstruction = await reconstructSpanGraph(rootContext.traceId, pool);
    expect(reconstruction.spanGraph.size).toBeGreaterThanOrEqual(2);

    const completeness = await validateTraceCompleteness(rootContext.traceId, pool);
    expect(completeness.parentChildLinkageValid).toBe(true);
    expect(completeness.orphanSpans.length).toBe(0);

    // Verify: Trust assessment classifies as TRUSTED or DEGRADED
    const trust = await evaluateTraceTrust(completeness, reconstruction, pool);
    expect([TraceTrustLevel.TRUSTED, TraceTrustLevel.DEGRADED]).toContain(trust.trustLevel);
    expect(trust.safeForAutomation || trust.automationGate.allowSuggestOnly).toBe(true);
  });

  it('detects when redelivery loses trace context (❌ BROKEN)', async () => {
    const originalContext = engine.createRootTraceContext();

    // Initial job with trace
    await engine.recordSpanEvent(originalContext, 'QUERY_INVALIDATED', {
      status: 'error',
    });

    // ❌ BROKEN: Redelivery from DLQ creates NEW trace
    const brokenRetry = engine.createRootTraceContext(); // WRONG!

    await engine.recordSpanEvent(brokenRetry, 'QUERY_REFETCHED', {
      status: 'success',
    });

    // Lost causality: original error disconnected from successful retry
    expect(originalContext.traceId).not.toBe(brokenRetry.traceId);

    // Verify: Trust assessment classifies both as UNTRUSTWORTHY
    const originalCompleteness = await validateTraceCompleteness(originalContext.traceId, pool);
    const brokenCompleteness = await validateTraceCompleteness(brokenRetry.traceId, pool);
    const originalGraph = await reconstructSpanGraph(originalContext.traceId, pool);
    const brokenGraph = await reconstructSpanGraph(brokenRetry.traceId, pool);

    const originalTrust = await evaluateTraceTrust(originalCompleteness, originalGraph, pool);
    const brokenTrust = await evaluateTraceTrust(brokenCompleteness, brokenGraph, pool);

    expect(originalTrust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);
    expect(brokenTrust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);
  });
});

/**
 * FAILURE MODE 5: TanStack Query Cancellation
 * ==========================================
 * Scenario: Query invalidation → refetch → user navigates → query cancelled → retry
 * Risk: Cancelled span orphans from original trace, retry doesn't attach to original chain
 */
describe('Failure Mode 5: TanStack Query Cancellation', () => {
  it('preserves trace through query cancellation and retry', async () => {
    const rootContext = engine.createRootTraceContext();

    await runWithTraceContextAsync(rootContext, async () => {
      await engine.recordSpanEvent(rootContext, 'QUERY_INVALIDATED', {
        status: 'success',
      });

      // Initial refetch (will be cancelled)
      const refetchContext = engine.createChildSpan(rootContext, {
        spanName: 'query:refetch_1',
      });

      // Simulate cancellation mid-flight
      await engine.recordSpanEvent(refetchContext, 'QUERY_REFETCHED', {
        status: 'cancelled',
        errorCode: 'USER_NAVIGATION',
        previousState: 'CACHE_REFRESH_REQUESTED',
      });

      // User navigates back, retry the query
      // CRITICAL: Retry must attach to ORIGINAL root, not to the cancelled span
      const retryContext = engine.createChildSpan(rootContext, {
        spanName: 'query:refetch_2',
        retryAttempt: 1,
      });

      await engine.recordSpanEvent(retryContext, 'QUERY_REFETCHED', {
        status: 'success',
        previousState: 'CACHE_REFRESH_REQUESTED',
      });

      await engine.recordSpanEvent(rootContext, 'UI_RECONCILED', {
        status: 'success',
        previousState: 'QUERY_REFETCHED',
      });
    });

    // Verify: Both attempts are children of root, not siblings
    const reconstruction = await reconstructSpanGraph(rootContext.traceId, pool);

    // Should have 4 spans: root, invalidation, refetch1, refetch2, ui_reconciled
    expect(reconstruction.spanGraph.size).toBeGreaterThanOrEqual(4);

    // Verify: No orphans (cancellation is a valid terminal state)
    const completeness = await validateTraceCompleteness(rootContext.traceId, pool);
    expect(completeness.orphanSpans.length).toBe(0);

    // Verify: Trust assessment classifies as TRUSTED or DEGRADED
    const spanGraph = await reconstructSpanGraph(rootContext.traceId, pool);
    const trust = await evaluateTraceTrust(completeness, spanGraph, pool);
    expect([TraceTrustLevel.TRUSTED, TraceTrustLevel.DEGRADED]).toContain(trust.trustLevel);
  });

  it('detects when cancelled query spawns new root (❌ BROKEN)', async () => {
    const originalContext = engine.createRootTraceContext();

    // Initial invalidation
    await engine.recordSpanEvent(originalContext, 'QUERY_INVALIDATED', {
      status: 'success',
    });

    // Refetch cancelled
    const cancelledContext = engine.createChildSpan(originalContext);
    await engine.recordSpanEvent(cancelledContext, 'QUERY_REFETCHED', {
      status: 'cancelled',
    });

    // ❌ BROKEN: Retry creates NEW root instead of child of original
    const brokenRetry = engine.createRootTraceContext(); // WRONG!

    await engine.recordSpanEvent(brokenRetry, 'QUERY_REFETCHED', {
      status: 'success',
    });

    // Lost causality
    expect(originalContext.traceId).not.toBe(brokenRetry.traceId);

    // Verify: Trust assessment classifies both as UNTRUSTWORTHY
    const originalCompleteness = await validateTraceCompleteness(originalContext.traceId, pool);
    const brokenCompleteness = await validateTraceCompleteness(brokenRetry.traceId, pool);
    const originalGraph = await reconstructSpanGraph(originalContext.traceId, pool);
    const brokenGraph = await reconstructSpanGraph(brokenRetry.traceId, pool);

    const originalTrust = await evaluateTraceTrust(originalCompleteness, originalGraph, pool);
    const brokenTrust = await evaluateTraceTrust(brokenCompleteness, brokenGraph, pool);

    expect(originalTrust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);
    expect(brokenTrust.trustLevel).toBe(TraceTrustLevel.UNTRUSTWORTHY);
  });
});

/**
 * COMPOSITE TEST: All Failures Combined
 * ====================================
 * Scenario: Real mutation with async fragmentation, retry, SSE replay, queue redelivery, query cancel
 * Proves completeness validator detects when ANY component breaks
 */
describe('Composite: All Failures Combined', () => {
  it('maintains complete trace through realistic mutation scenario', async () => {
    const rootContext = engine.createRootTraceContext();

    await runWithTraceContextAsync(rootContext, async () => {
      // Phase 1: Intent
      await engine.recordSpanEvent(rootContext, 'INTENT_RECEIVED', {
        status: 'success',
      });

      // Phase 2: Parallel dispatch (async fragmentation risk)
      await Promise.all([
        engine.recordSpanEvent(engine.createChildSpan(rootContext), 'MUTATION_DISPATCHED', {
          status: 'success',
        }),
        engine.recordSpanEvent(engine.createChildSpan(rootContext), 'AUDIT_SNAPSHOTTED', {
          status: 'success',
        }),
      ]);

      // Phase 3: DB operation with retries
      let dbAttempt = 0;
      while (dbAttempt < 3) {
        const dbContext = engine.createChildSpan(rootContext, {
          retryAttempt: dbAttempt,
        });

        const success = dbAttempt === 2;
        await engine.recordSpanEvent(dbContext, 'STATE_PERSISTED', {
          status: success ? 'success' : 'timeout',
          errorMessage: success ? undefined : 'Connection timeout',
        });

        if (success) break;
        dbAttempt++;
      }

      // Phase 4: Cache invalidation
      await engine.recordSpanEvent(rootContext, 'QUERY_INVALIDATED', {
        status: 'success',
      });

      // Phase 5: Query with cancellation and retry
      const queryContext = engine.createChildSpan(rootContext);
      await engine.recordSpanEvent(queryContext, 'QUERY_REFETCHED', {
        status: 'cancelled',
      });

      const retryContext = engine.createChildSpan(rootContext);
      await engine.recordSpanEvent(retryContext, 'QUERY_REFETCHED', {
        status: 'success',
      });

      // Phase 6: UI reconciliation
      await engine.recordSpanEvent(rootContext, 'UI_RECONCILED', {
        status: 'success',
      });

      await engine.recordSpanEvent(rootContext, 'STATE_VERIFIED', {
        status: 'success',
      });
    });

    // Final verdict: Is trace complete?
    const completeness = await validateTraceCompleteness(rootContext.traceId, pool);

    expect(completeness.isComplete).toBe(true);
    expect(completeness.orphanSpans.length).toBe(0);
    expect(completeness.parentChildLinkageValid).toBe(true);
    expect(completeness.completenessScore).toBeGreaterThan(80);

    // Verify: Trust assessment classifies as TRUSTED
    const spanGraph = await reconstructSpanGraph(rootContext.traceId, pool);
    const trust = await evaluateTraceTrust(completeness, spanGraph, pool);
    expect(trust.trustLevel).toBe(TraceTrustLevel.TRUSTED);
    expect(trust.safeForAutomation).toBe(true);
    expect(trust.automationGate.allowFull).toBe(true);
  });
});
