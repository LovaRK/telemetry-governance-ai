/**
 * Phase 9 - Event Purity Chaos Test
 * Tests that all events are emitted through pure entry point with metadata
 */

import { describe, it, expect } from 'vitest';

interface PureEvent {
  type: string;
  [key: string]: any;
  source?: string;
  mode?: string;
  traceId?: string;
}

const emittedEvents: any[] = [];

// ❌ BROKEN: Old emit function without purity enforcement
async function emit(event: any) {
  emittedEvents.push(event);
}

// ✅ CORRECT: Pure event emitter with enforcement
async function emitPureEvent(event: PureEvent, traceId: string) {
  const enriched: PureEvent = {
    ...event,
    source: 'system',
    mode: 'live',
    traceId,
  };
  emittedEvents.push(enriched);
}

describe('Phase 9: Event Purity', () => {
  beforeEach(() => {
    emittedEvents.length = 0;
  });

  it('❌ FAILS: Direct emit() call without purity metadata', async () => {
    await emit({
      type: 'decision_executed',
      decisionId: 123
    });

    const event = emittedEvents[0];
    
    expect(event.source).toBeDefined();
    expect(event.mode).toBeDefined();
    expect(event.traceId).toBeDefined();
  });

  it('❌ FAILS: Event missing source attribution', async () => {
    await emit({
      type: 'execution_started',
      executionId: 456
    });

    expect(emittedEvents[0].source).toBe('system');
  });

  it('❌ FAILS: Event missing purity mode', async () => {
    await emit({
      type: 'reconciliation_applied',
      mutations: []
    });

    expect(emittedEvents[0].mode).toBe('live');
  });

  it('❌ FAILS: Event not linked to trace', async () => {
    await emit({
      type: 'policy_evaluated',
      guardrails: ['cost_limit']
    });

    expect(emittedEvents[0].traceId).toBeDefined();
    expect(typeof emittedEvents[0].traceId).toBe('string');
  });

  it('✅ PASSES: Pure event with full metadata', async () => {
    await emitPureEvent(
      {
        type: 'decision_executed',
        decisionId: 789
      },
      'trace-xyz-789'
    );

    const event = emittedEvents[0];
    expect(event.source).toBe('system');
    expect(event.mode).toBe('live');
    expect(event.traceId).toBe('trace-xyz-789');
  });

  it('✅ PASSES: emitPureEvent enforces all invariants', async () => {
    const testEvent = {
      type: 'test_event',
      payload: { test: true }
    };

    await emitPureEvent(testEvent, 'test-trace-123');

    const emitted = emittedEvents[0];
    
    // Check enrichment happened
    expect(emitted.type).toBe('test_event');
    expect(emitted.payload.test).toBe(true);
    expect(emitted.source).toBe('system');
    expect(emitted.mode).toBe('live');
    expect(emitted.traceId).toBe('test-trace-123');
  });
});
