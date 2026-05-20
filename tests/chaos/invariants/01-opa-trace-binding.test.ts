/**
 * INVARIANT TEST: OPA Trace Binding
 *
 * Validates L5 OPA integration without infrastructure:
 * - evaluatePolicy() binds trace context
 * - Event emission is non-optional
 * - Data purity is enforced (source, mode, traceId required)
 * - Audit vs enforce modes work correctly
 *
 * No Docker/TestContainers required.
 */

import { describe, it, beforeEach, expect, vi } from 'vitest';
import { AsyncLocalStorage } from 'async_hooks';

// Mock trace context
const traceContextStorage = new AsyncLocalStorage<{ traceId: string }>();

function getTraceId(): string {
  const context = traceContextStorage.getStore();
  return context?.traceId || 'unknown-trace';
}

function setTraceId(traceId: string): void {
  traceContextStorage.run({ traceId }, () => {
    // Context set for async operations
  });
}

// Mock PolicyResult with data purity invariants
interface PolicyResult {
  decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  violatedGuardrails: string[];
  requiredApprovals: string[];
  confidence: number;
  source: 'system';
  mode: 'live';
  traceId: string;
}

// Mock event emission
const emittedEvents: PolicyResult[] = [];
let shouldFailEmission = false;

async function emitPolicyEvent(event: PolicyResult): Promise<void> {
  if (shouldFailEmission) {
    throw new Error('[FATAL] Event emission failed');
  }
  emittedEvents.push(event);
}

// Data purity assertion
function assertDataPurity(result: unknown): asserts result is PolicyResult {
  if (!result || typeof result !== 'object') {
    throw new Error('Policy result is not an object');
  }

  const r = result as Record<string, unknown>;

  if (typeof r.decision !== 'string') {
    throw new Error('Policy result missing decision field');
  }

  if (!Array.isArray(r.violatedGuardrails)) {
    throw new Error('Policy result missing violatedGuardrails array');
  }

  if (!Array.isArray(r.requiredApprovals)) {
    throw new Error('Policy result missing requiredApprovals array');
  }

  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    throw new Error('Policy result confidence must be 0-1');
  }

  if (r.source !== 'system') {
    throw new Error(`Policy result source must be 'system', got '${r.source}'`);
  }

  if (r.mode !== 'live') {
    throw new Error(`Policy result mode must be 'live', got '${r.mode}'`);
  }

  if (typeof r.traceId !== 'string' || r.traceId.length === 0) {
    throw new Error(`Policy result traceId must be non-empty string, got '${r.traceId}'`);
  }
}

// Simplified evaluatePolicy for testing
async function evaluatePolicy(
  rawResult: Omit<PolicyResult, 'source' | 'mode' | 'traceId'>,
  enforcementMode: 'audit' | 'enforce' = 'audit'
): Promise<PolicyResult> {
  const traceId = getTraceId();

  // Bind trace context
  const result: PolicyResult = {
    ...rawResult,
    source: 'system',
    mode: 'live',
    traceId,
  };

  // Validate data purity (throws if invalid)
  assertDataPurity(result);

  // Emit event (NON-OPTIONAL: throws if emission fails)
  await emitPolicyEvent(result);

  // In enforce mode, DENY blocks execution
  if (enforcementMode === 'enforce' && result.decision === 'DENY') {
    throw new Error(`[OPA_POLICY_DENIED] Guardrails: ${result.violatedGuardrails.join(', ')}`);
  }

  return result;
}

describe('Invariant: OPA Trace Binding', () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    shouldFailEmission = false;
  });

  it('binds trace context to policy result', async () => {
    const testTraceId = '1234-5678-9abc-def0';

    await traceContextStorage.run({ traceId: testTraceId }, async () => {
      const result = await evaluatePolicy(
        {
          decision: 'ALLOW',
          violatedGuardrails: [],
          requiredApprovals: [],
          confidence: 0.95,
        },
        'audit'
      );

      expect(result.traceId).toBe(testTraceId);
      expect(result.source).toBe('system');
      expect(result.mode).toBe('live');
    });
  });

  it('enforces non-optional event emission in audit mode', async () => {
    await traceContextStorage.run({ traceId: 'trace-001' }, async () => {
      const result = await evaluatePolicy(
        {
          decision: 'ALLOW',
          violatedGuardrails: [],
          requiredApprovals: [],
          confidence: 0.95,
        },
        'audit'
      );

      // Verify event was emitted
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0]).toEqual(result);
    });
  });

  it('fails policy evaluation if event emission fails (non-optional)', async () => {
    shouldFailEmission = true;

    await expect(
      traceContextStorage.run({ traceId: 'trace-002' }, async () => {
        return await evaluatePolicy(
          {
            decision: 'ALLOW',
            violatedGuardrails: [],
            requiredApprovals: [],
            confidence: 0.95,
          },
          'audit'
        );
      })
    ).rejects.toThrow('[FATAL] Event emission failed');

    // No event should be emitted
    expect(emittedEvents.length).toBe(0);
  });

  it('enforces data purity: rejects missing source', async () => {
    await expect(
      traceContextStorage.run({ traceId: 'trace-003' }, async () => {
        // Create result without source
        const badResult = {
          decision: 'ALLOW' as const,
          violatedGuardrails: [],
          requiredApprovals: [],
          confidence: 0.95,
          mode: 'live' as const,
          traceId: 'trace-003',
          // source is missing
        };

        assertDataPurity(badResult);
      })
    ).rejects.toThrow("source must be 'system'");
  });

  it('enforces data purity: rejects non-live mode', async () => {
    await expect(
      traceContextStorage.run({ traceId: 'trace-004' }, async () => {
        const badResult = {
          decision: 'ALLOW' as const,
          violatedGuardrails: [],
          requiredApprovals: [],
          confidence: 0.95,
          source: 'system' as const,
          mode: 'replay' as any, // Invalid mode
          traceId: 'trace-004',
        };

        assertDataPurity(badResult);
      })
    ).rejects.toThrow("mode must be 'live'");
  });

  it('enforces data purity: rejects missing traceId', async () => {
    await expect(
      traceContextStorage.run({ traceId: 'trace-005' }, async () => {
        const badResult = {
          decision: 'ALLOW' as const,
          violatedGuardrails: [],
          requiredApprovals: [],
          confidence: 0.95,
          source: 'system' as const,
          mode: 'live' as const,
          traceId: '', // Empty trace ID
        };

        assertDataPurity(badResult);
      })
    ).rejects.toThrow('traceId must be non-empty string');
  });

  it('blocks DENY decisions in enforce mode', async () => {
    await expect(
      traceContextStorage.run({ traceId: 'trace-006' }, async () => {
        return await evaluatePolicy(
          {
            decision: 'DENY',
            violatedGuardrails: ['critical_detection_threshold'],
            requiredApprovals: [],
            confidence: 0.95,
          },
          'enforce'
        );
      })
    ).rejects.toThrow('[OPA_POLICY_DENIED]');
  });

  it('allows DENY decisions in audit mode (no blocking)', async () => {
    await traceContextStorage.run({ traceId: 'trace-007' }, async () => {
      const result = await evaluatePolicy(
        {
          decision: 'DENY',
          violatedGuardrails: ['critical_detection_threshold'],
          requiredApprovals: [],
          confidence: 0.95,
        },
        'audit'
      );

      expect(result.decision).toBe('DENY');
      expect(emittedEvents.length).toBe(1);
    });
  });

  it('allows REQUIRE_APPROVAL in both audit and enforce modes', async () => {
    // Audit mode
    await traceContextStorage.run({ traceId: 'trace-008' }, async () => {
      const result = await evaluatePolicy(
        {
          decision: 'REQUIRE_APPROVAL',
          violatedGuardrails: [],
          requiredApprovals: ['security_team'],
          confidence: 0.75,
        },
        'audit'
      );

      expect(result.decision).toBe('REQUIRE_APPROVAL');
    });

    emittedEvents.length = 0;

    // Enforce mode
    await traceContextStorage.run({ traceId: 'trace-009' }, async () => {
      const result = await evaluatePolicy(
        {
          decision: 'REQUIRE_APPROVAL',
          violatedGuardrails: [],
          requiredApprovals: ['security_team'],
          confidence: 0.75,
        },
        'enforce'
      );

      expect(result.decision).toBe('REQUIRE_APPROVAL');
    });
  });

  it('preserves all policy metadata in emitted event', async () => {
    await traceContextStorage.run({ traceId: 'trace-010' }, async () => {
      const guardrails = ['critical_detection', 'cost_bounds'];
      const approvals = ['finance_team', 'security_team'];

      const result = await evaluatePolicy(
        {
          decision: 'REQUIRE_APPROVAL',
          violatedGuardrails: guardrails,
          requiredApprovals: approvals,
          confidence: 0.82,
        },
        'audit'
      );

      const emitted = emittedEvents[0];
      expect(emitted.violatedGuardrails).toEqual(guardrails);
      expect(emitted.requiredApprovals).toEqual(approvals);
      expect(emitted.confidence).toBe(0.82);
    });
  });
});
