/**
 * Phase 9 - API Response Purity Chaos Test
 * Tests that all API endpoints return complete metadata
 */

import { describe, it, expect } from 'vitest';

interface ApiResponse {
  data?: any;
  meta?: {
    source?: string;
    mode?: string;
    traceId?: string;
  };
}

async function mockHealthEndpoint(): Promise<ApiResponse> {
  // ❌ BROKEN: Returns only data, no meta
  return {
    data: {
      status: 'ok',
      timestamp: new Date().toISOString()
    }
  };
}

async function mockAgentDecisionsEndpoint(): Promise<ApiResponse> {
  // ❌ BROKEN: meta exists but missing fields
  return {
    data: [
      { id: 1, decision: 'execute' },
      { id: 2, decision: 'defer' }
    ],
    meta: {
      source: 'postgres'
      // Missing: mode, traceId
    }
  };
}

describe('Phase 9: API Response Purity', () => {
  it('❌ FAILS: Health endpoint missing meta', async () => {
    const response = await mockHealthEndpoint();
    
    expect(response.meta).toBeDefined();
    expect(response.meta?.source).toBeDefined();
    expect(response.meta?.mode).toBeDefined();
    expect(response.meta?.traceId).toBeDefined();
  });

  it('❌ FAILS: API meta missing mode', async () => {
    const response = await mockAgentDecisionsEndpoint();
    
    expect(response.meta?.mode).toBe('live');
  });

  it('❌ FAILS: API meta missing traceId', async () => {
    const response = await mockAgentDecisionsEndpoint();
    
    expect(response.meta?.traceId).toBeDefined();
    expect(typeof response.meta?.traceId).toBe('string');
  });

  it('❌ FAILS: API response has data but no attribution', async () => {
    const response = await mockHealthEndpoint();
    
    if (response.data) {
      expect(response.meta?.source).toBeDefined();
    }
  });
});
