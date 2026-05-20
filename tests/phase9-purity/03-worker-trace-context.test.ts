/**
 * Phase 9 - Worker Trace Context Chaos Test
 * Tests that workers execute within trace context
 */

import { describe, it, expect } from 'vitest';

let currentTraceId: string | null = null;

function setTraceContext(traceId: string) {
  currentTraceId = traceId;
}

function getTraceId(): string {
  if (!currentTraceId) {
    throw new Error('❌ SYSTEM_INVARIANT_VIOLATION: Missing trace context');
  }
  return currentTraceId;
}

async function mockWorkerWithoutContext() {
  // ❌ BROKEN: Worker runs without trace context wrapping
  try {
    const traceId = getTraceId();
    console.log(`Worker running with trace: ${traceId}`);
  } catch (error) {
    throw error;
  }
}

async function mockWorkerWithContext() {
  // ✅ CORRECT: Worker wrapped with trace
  return new Promise((resolve) => {
    setTraceContext('worker-trace-456');
    try {
      const traceId = getTraceId();
      console.log(`Worker running with trace: ${traceId}`);
      resolve(true);
    } finally {
      currentTraceId = null;
    }
  });
}

describe('Phase 9: Worker Trace Context', () => {
  it('❌ FAILS: Worker without trace context wrapper', async () => {
    currentTraceId = null;
    
    try {
      await mockWorkerWithoutContext();
      expect.fail('Should have thrown missing trace error');
    } catch (error: any) {
      expect(error.message).toContain('Missing trace context');
    }
  });

  it('✅ PASSES: Worker with trace context wrapper', async () => {
    const result = await mockWorkerWithContext();
    expect(result).toBe(true);
  });

  it('❌ FAILS: Verify trace isolation between workers', async () => {
    currentTraceId = 'worker-1-trace';
    const trace1 = getTraceId();
    
    // Simulate second worker without resetting context
    const trace2 = getTraceId();
    
    // Both would return the same trace due to no isolation
    expect(trace1).toBe(trace2); // This is the problem!
  });
});
