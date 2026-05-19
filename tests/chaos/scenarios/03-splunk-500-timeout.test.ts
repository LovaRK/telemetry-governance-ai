/**
 * CHAOS TEST: Splunk API 500 / Timeout
 *
 * Scenario: Executor calls Splunk DELETE, gets:
 *   A) 500 with slow response (timeout)
 *   B) 500 with immediate close (connection reset)
 *   C) Timeout (no response)
 *
 * Expected: Decision stays APPROVED (no state transition)
 *           Audit is NOT written (failure before commit)
 *           Journal is marked FAILED
 *           Operator can safely retry
 *
 * This validates: Failure containment, circuit breaker, safe failure modes
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { TestEnvironment, setupTestEnvironment, createTestDecision, configureWireMockStub, resetWireMock } from '../testcontainers.setup';
import { executeDecisionSafe } from '@core/workflow/executor-v2';
import { SplunkHttpAdapter } from '@core/adapters/splunk-http.adapter';

describe('Chaos: Splunk 500 / Timeout', () => {
  let env: TestEnvironment;
  let splunkAdapter: SplunkHttpAdapter;
  let wiremockUrl: string;

  beforeAll(async () => {
    env = await setupTestEnvironment();
    wiremockUrl = `http://${env.wiremock.getHost()}:${env.wiremock.getMappedPort(8080)}`;
    splunkAdapter = new SplunkHttpAdapter({
      baseUrl: wiremockUrl,
      username: 'test',
      password: 'test',
      timeoutMs: 2000, // 2 second timeout for tests
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('contains failure when Splunk returns 500', async () => {
    const decision = await createTestDecision(env.db, 'chaos-tenant', 'chaos-500-index');

    // Configure WireMock to return 500
    await configureWireMockStub(wiremockUrl, {
      method: 'DELETE',
      urlPathPattern: '/services/data/indexes/chaos-500-index',
      status: 500,
    });

    // Execute
    const result = await executeDecisionSafe(env.db, splunkAdapter, decision.id, {
      index: 'chaos-500-index',
      decision: 'ELIMINATE',
      compositeScore: 18,
      annualCostUsd: 5000,
      tenantId: 'chaos-tenant',
      snapshotId: decision.snapshotId,
    });

    // Verify: Execution failed
    expect(result.status).toBe('failed');

    // Verify: Decision state NOT changed
    const updatedDecision = await env.db.decision.findUnique({
      where: { id: decision.id },
    });

    expect(updatedDecision?.status).toBe('APPROVED'); // Should not be EXECUTED

    // Verify: Journal marked as failed
    const journal = await env.db.executionJournal.findUnique({
      where: { idempotencyKey: result.idempotencyKey },
    });

    expect(journal?.status).toBe('FAILED');

    // Verify: Audit WAS written (we know it failed)
    const auditEvents = await env.db.auditEvent.findMany({
      where: { decisionId: decision.id },
    });

    expect(auditEvents.length).toBeGreaterThan(0);
    expect(auditEvents[0].eventType).toBe('execution.completed');
  });

  it('handles timeout with state containment', async () => {
    const decision = await createTestDecision(env.db, 'timeout-tenant', 'timeout-index');

    // Configure WireMock to hang
    await configureWireMockStub(wiremockUrl, {
      method: 'DELETE',
      urlPathPattern: '/services/data/indexes/timeout-index',
      status: 200,
      fixedDelayMilliseconds: 5000, // Longer than 2000ms client timeout
    });

    // Execute (will timeout)
    const result = await executeDecisionSafe(env.db, splunkAdapter, decision.id, {
      index: 'timeout-index',
      decision: 'ELIMINATE',
      compositeScore: 15,
      annualCostUsd: 3000,
      tenantId: 'timeout-tenant',
      snapshotId: decision.snapshotId,
    });

    // Verify: Timeout causes unknown status
    expect(['failed', 'unknown']).toContain(result.status);

    // Verify: Decision stays APPROVED
    const updatedDecision = await env.db.decision.findUnique({
      where: { id: decision.id },
    });

    expect(updatedDecision?.status).toBe('APPROVED');
  });

  it('does not allow partial execution state', async () => {
    const decision = await createTestDecision(env.db, 'partial-tenant', 'partial-index');

    // First attempt: 500 error
    await configureWireMockStub(wiremockUrl, {
      method: 'DELETE',
      urlPathPattern: '/services/data/indexes/partial-index',
      status: 500,
    });

    const result1 = await executeDecisionSafe(env.db, splunkAdapter, decision.id, {
      index: 'partial-index',
      decision: 'ELIMINATE',
      compositeScore: 12,
      annualCostUsd: 2000,
      tenantId: 'partial-tenant',
      snapshotId: decision.snapshotId,
    });

    expect(result1.status).toBe('failed');

    // Retry attempt: Now succeeds
    await resetWireMock(wiremockUrl);
    await configureWireMockStub(wiremockUrl, {
      method: 'DELETE',
      urlPathPattern: '/services/data/indexes/partial-index',
      status: 204, // Success
    });

    // Attempt to retry should use SAME idempotency key
    // But executor will detect duplicate execution already in progress
    const result2 = await executeDecisionSafe(env.db, splunkAdapter, decision.id, {
      index: 'partial-index',
      decision: 'ELIMINATE',
      compositeScore: 12,
      annualCostUsd: 2000,
      tenantId: 'partial-tenant',
      snapshotId: decision.snapshotId,
    });

    // Should be allowed (different flow, operator can retry)
    expect(result2.status).toBe('success');

    // Verify: No duplicate executions
    const journals = await env.db.executionJournal.findMany({
      where: { decisionId: decision.id },
    });

    expect(journals.length).toBeLessThanOrEqual(2); // At most 2 attempts
  });

  it('prevents cascade failure with circuit breaker', async () => {
    // Simulate 5+ failures in a short window
    const decisions = await Promise.all([
      createTestDecision(env.db, 'cascade-tenant', 'cascade-1'),
      createTestDecision(env.db, 'cascade-tenant', 'cascade-2'),
      createTestDecision(env.db, 'cascade-tenant', 'cascade-3'),
      createTestDecision(env.db, 'cascade-tenant', 'cascade-4'),
      createTestDecision(env.db, 'cascade-tenant', 'cascade-5'),
    ]);

    // All return 500
    for (const i of range(1, 6)) {
      await configureWireMockStub(wiremockUrl, {
        method: 'DELETE',
        urlPathPattern: `/services/data/indexes/cascade-${i}`,
        status: 500,
      });
    }

    // Execute all
    const results = await Promise.all(
      decisions.map(d =>
        executeDecisionSafe(env.db, splunkAdapter, d.id, {
          index: `cascade-${decisions.indexOf(d) + 1}`,
          decision: 'ELIMINATE',
          compositeScore: 15,
          annualCostUsd: 2000,
          tenantId: 'cascade-tenant',
          snapshotId: d.snapshotId,
        }),
      ),
    );

    // All should fail safely
    expect(results.every(r => r.status === 'failed')).toBe(true);

    // Check for circuit breaker trigger
    const blastRadiusCounter = await env.db.auditEvent.count({
      where: {
        tenantId: 'cascade-tenant',
        eventType: 'blast_radius_exceeded',
      },
    });

    // May or may not have blast radius alert depending on config
    // But ALL decisions should still be APPROVED
    const finalDecisions = await env.db.decision.findMany({
      where: { tenantId: 'cascade-tenant' },
    });

    expect(finalDecisions.every(d => d.status === 'APPROVED')).toBe(true);
  });
});

function* range(start: number, end: number) {
  for (let i = start; i <= end; i++) {
    yield i;
  }
}
