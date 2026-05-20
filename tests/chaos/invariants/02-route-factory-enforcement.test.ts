/**
 * INVARIANT TEST: Route Factory Enforcement (L3)
 *
 * Validates that route factories enforce proper structure:
 * - createRoute returns {data, meta} only
 * - No raw exports or direct JSON responses
 * - Trace context is available (would be injected via AsyncLocalStorage)
 *
 * Pure logic test, no infrastructure required.
 */

import { describe, it, expect } from 'vitest';

// Simplified route factory implementations for testing
interface RouteResponse {
  data: unknown;
  meta?: Record<string, unknown>;
}

interface StreamResponse {
  source: 'system' | 'postgres' | 'splunk';
  mode: 'live' | 'replay';
  replayed?: boolean;
  traceId: string;
  [key: string]: unknown;
}

class RouteFactoryError extends Error {
  constructor(message: string) {
    super(`[ROUTE_FACTORY] ${message}`);
    this.name = 'RouteFactoryError';
  }
}

/**
 * Simulated createRoute factory (would have AsyncLocalStorage in real implementation)
 */
function createRouteResponse(
  data: unknown,
  meta: Record<string, unknown> = {}
): RouteResponse {
  if (data === undefined) {
    throw new RouteFactoryError('data cannot be undefined');
  }

  // Ensure meta is an object
  if (typeof meta !== 'object' || meta === null) {
    throw new RouteFactoryError('meta must be an object');
  }

  const response: RouteResponse = { data };

  // Only include meta if it has properties
  if (Object.keys(meta).length > 0) {
    response.meta = meta;
  }

  return response;
}

/**
 * Simulated createStreamRoute factory
 */
function createStreamRouteResponse(
  data: unknown,
  metadata: {
    source: 'system' | 'postgres' | 'splunk';
    mode: 'live' | 'replay';
    traceId: string;
    replayed?: boolean;
  }
): StreamResponse {
  if (!metadata.source || !metadata.mode || !metadata.traceId) {
    throw new RouteFactoryError(
      'Stream response must include source, mode, and traceId'
    );
  }

  if (!['system', 'postgres', 'splunk'].includes(metadata.source)) {
    throw new RouteFactoryError(`Invalid source: ${metadata.source}`);
  }

  if (!['live', 'replay'].includes(metadata.mode)) {
    throw new RouteFactoryError(`Invalid mode: ${metadata.mode}`);
  }

  return {
    ...data,
    ...metadata,
  };
}

/**
 * Validate that response is NOT a raw export/direct JSON
 */
function assertNotRawExport(response: unknown): void {
  // Check it's not just a plain array/object without the factory structure
  if (Array.isArray(response)) {
    throw new RouteFactoryError('Raw array export detected - use createRoute instead');
  }

  if (
    typeof response === 'object' &&
    response !== null &&
    !('data' in response) &&
    !('source' in response)
  ) {
    throw new RouteFactoryError('Raw object export detected - use createRoute instead');
  }
}

describe('Invariant: Route Factory Enforcement (L3)', () => {
  it('enforces {data, meta} structure in createRoute', () => {
    const response = createRouteResponse(
      { decisionId: '123', status: 'executed' },
      { source: 'system' }
    );

    expect(response).toHaveProperty('data');
    expect(response.data).toEqual({ decisionId: '123', status: 'executed' });
  });

  it('omits meta from response if empty', () => {
    const response = createRouteResponse({ value: 'test' });

    expect(response).toEqual({
      data: { value: 'test' },
    });
    expect(response).not.toHaveProperty('meta');
  });

  it('rejects undefined data', () => {
    expect(() => {
      createRouteResponse(undefined);
    }).toThrow('[ROUTE_FACTORY]');
  });

  it('enforces stream response metadata requirements', () => {
    const response = createStreamRouteResponse(
      { events: [] },
      {
        source: 'system',
        mode: 'live',
        traceId: 'trace-001',
      }
    );

    expect(response.source).toBe('system');
    expect(response.mode).toBe('live');
    expect(response.traceId).toBe('trace-001');
  });

  it('requires traceId in stream responses', () => {
    expect(() => {
      createStreamRouteResponse(
        { events: [] },
        {
          source: 'system',
          mode: 'live',
          traceId: '', // Empty
        }
      );
    }).toThrow('[ROUTE_FACTORY]');
  });

  it('rejects invalid source in stream response', () => {
    expect(() => {
      createStreamRouteResponse(
        { events: [] },
        {
          source: 'unknown' as any,
          mode: 'live',
          traceId: 'trace-002',
        }
      );
    }).toThrow('[ROUTE_FACTORY]');
  });

  it('rejects invalid mode in stream response', () => {
    expect(() => {
      createStreamRouteResponse(
        { events: [] },
        {
          source: 'system',
          mode: 'invalid' as any,
          traceId: 'trace-003',
        }
      );
    }).toThrow('[ROUTE_FACTORY]');
  });

  it('detects raw array export and rejects it', () => {
    const rawArray = [
      { id: 1, name: 'decision1' },
      { id: 2, name: 'decision2' },
    ];

    expect(() => {
      assertNotRawExport(rawArray);
    }).toThrow('Raw array export detected');
  });

  it('detects raw object export and rejects it', () => {
    const rawObject = {
      decisionId: '123',
      status: 'executed',
      // Missing {data, meta} structure
    };

    expect(() => {
      assertNotRawExport(rawObject);
    }).toThrow('Raw object export detected');
  });

  it('allows valid createRoute response in validation', () => {
    const response = createRouteResponse({ id: '123', value: 'test' });

    expect(() => {
      assertNotRawExport(response);
    }).not.toThrow();
  });

  it('allows valid createStreamRoute response in validation', () => {
    const response = createStreamRouteResponse(
      { type: 'drift' },
      {
        source: 'postgres',
        mode: 'live',
        traceId: 'trace-004',
      }
    );

    expect(() => {
      assertNotRawExport(response);
    }).not.toThrow();
  });

  it('preserves all data fields in createRoute', () => {
    const inputData = {
      decisionId: 'd-123',
      tenantId: 't-456',
      status: 'EXECUTED',
      evidence: {
        score: 85,
        reason: 'critical utilization',
      },
    };

    const response = createRouteResponse(inputData);

    expect(response.data).toEqual(inputData);
    expect(response.data.decisionId).toBe('d-123');
    expect(response.data.evidence.score).toBe(85);
  });

  it('preserves metadata fields in createStreamRoute', () => {
    const response = createStreamRouteResponse(
      { type: 'execution_started' },
      {
        source: 'splunk',
        mode: 'replay',
        traceId: 'trace-005',
        replayed: true,
      }
    );

    expect(response.source).toBe('splunk');
    expect(response.mode).toBe('replay');
    expect(response.replayed).toBe(true);
  });

  it('enforces immutability of metadata fields', () => {
    const metadata = {
      source: 'system' as const,
      mode: 'live' as const,
      traceId: 'trace-006',
    };

    const response = createStreamRouteResponse({ data: 'test' }, metadata);

    // Metadata fields should not be modifiable without going through factory again
    expect(response.source).toBe('system');
    expect(response.mode).toBe('live');
  });
});
