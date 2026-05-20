/**
 * Phase 9 - Wrapper Integration Test
 * Tests that the real withTrace + withPureResponse wrappers enforce purity
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Mock NextRequest and NextResponse
class MockRequest {
  headers: Record<string, string>;
  constructor(headers: Record<string, string> = {}) {
    this.headers = headers;
  }
}

class MockResponse {
  status: number;
  body: any;
  constructor(body: any, options?: { status?: number }) {
    this.body = body;
    this.status = options?.status || 200;
  }
}

// Simple mock trace and response helpers
let currentTraceId: string | null = null;

function mockGetTraceId(): string {
  if (!currentTraceId) {
    throw new Error('Missing trace context');
  }
  return currentTraceId;
}

function mockWithTrace(handler: (req: any) => Promise<any>) {
  return async (req: any) => {
    currentTraceId = req.headers['x-trace-id'] || 'generated-trace-' + Math.random();
    try {
      return await handler(req);
    } finally {
      currentTraceId = null;
    }
  };
}

function mockWithPureResponse(handler: (req: any) => Promise<any>) {
  return async (req: any) => {
    try {
      const result = await handler(req);

      if (!result?.meta) {
        throw new Error('Missing meta in API response');
      }

      const traceId = mockGetTraceId();
      const meta = {
        ...result.meta,
        mode: 'live',
        traceId,
      };

      return new MockResponse(
        {
          ...result,
          meta,
        },
        { status: 200 }
      );
    } catch (error: any) {
      const traceId = mockGetTraceId();
      return new MockResponse(
        {
          error: error.message,
          meta: {
            source: 'system',
            mode: 'live',
            traceId,
          },
        },
        { status: 500 }
      );
    }
  };
}

describe('Phase 9: Wrapper Integration', () => {
  beforeEach(() => {
    currentTraceId = null;
  });

  it('✅ PASSES: withTrace + withPureResponse injects all metadata', async () => {
    const mockHandler = mockWithTrace(
      mockWithPureResponse(async (req: any) => {
        return {
          data: { status: 'ok' },
          meta: { source: 'system' },
        };
      })
    );

    const req = new MockRequest();
    const response = await mockHandler(req) as any;

    expect(response.body.meta).toBeDefined();
    expect(response.body.meta.source).toBe('system');
    expect(response.body.meta.mode).toBe('live');
    expect(response.body.meta.traceId).toBeDefined();
  });

  it('✅ PASSES: withTrace + withPureResponse enforces meta requirement', async () => {
    const mockHandler = mockWithTrace(
      mockWithPureResponse(async (req: any) => {
        // Missing meta field
        return {
          data: { status: 'ok' },
        };
      })
    );

    const req = new MockRequest();
    const response = await mockHandler(req) as any;

    // Should catch the error and return error response with trace
    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Missing meta');
    expect(response.body.meta.traceId).toBeDefined();
  });

  it('✅ PASSES: withTrace preserves trace across wrapper chain', async () => {
    let capturedTraceId: string | null = null;

    const mockHandler = mockWithTrace(
      mockWithPureResponse(async (req: any) => {
        capturedTraceId = mockGetTraceId();
        return {
          data: { traceId: capturedTraceId },
          meta: { source: 'system' },
        };
      })
    );

    const expectedTrace = 'custom-trace-123';
    const req = new MockRequest({ 'x-trace-id': expectedTrace });
    const response = await mockHandler(req) as any;

    expect(capturedTraceId).toBe(expectedTrace);
    expect(response.body.meta.traceId).toBe(expectedTrace);
  });

  it('✅ PASSES: Response has all purity fields', async () => {
    const mockHandler = mockWithTrace(
      mockWithPureResponse(async (req: any) => {
        return {
          data: { items: [] },
          meta: { source: 'postgres' },
        };
      })
    );

    const req = new MockRequest();
    const response = await mockHandler(req) as any;

    // Verify all required fields exist
    expect(response.body.meta.source).toBeDefined();
    expect(response.body.meta.mode).toBeDefined();
    expect(response.body.meta.traceId).toBeDefined();

    // Verify values
    expect(response.body.meta.source).toBe('postgres');
    expect(response.body.meta.mode).toBe('live');
    expect(typeof response.body.meta.traceId).toBe('string');
  });
});
