/**
 * Governance Trace Middleware
 *
 * Phase 1, Path B: Server-Side Boundary Hardening
 *
 * Responsibilities:
 * 1. Parse W3C Trace Context standard (traceparent header)
 * 2. Initialize AsyncLocalStorage context for current request
 * 3. Inject active topology_hash from system state
 * 4. Establish causal linkage for downstream spans
 *
 * Format: traceparent = "00-{traceId:32hex}-{spanId:16hex}-{flags:2hex}"
 * RFC: https://www.w3.org/TR/trace-context/
 */

import { Request, Response, NextFunction } from 'express';
import { ExecutionClass } from '@/services/trace-trust-evaluator';

/**
 * Active system topology hash
 * Injected from environment at boot
 * Updated during rolling deployments
 */
export const SYSTEM_TOPOLOGY_HASH = process.env.SYSTEM_TOPOLOGY_HASH || 'epoch_2026_boot_v1';

/**
 * Request-scoped governance context
 * Attached to AsyncLocalStorage for downstream propagation
 */
export interface GovernanceRequestContext {
  // W3C Trace Context
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  correlationId: string;

  // Execution metadata
  executionContext: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
  executionClass: ExecutionClass;

  // Infrastructure state
  topologyHash: string;
  requestTimestamp: number;
}

/**
 * Parse W3C traceparent header
 * Format: 00-{traceId}-{spanId}-{traceFlags}
 */
function parseTraceparent(
  traceparent: string | undefined
): { traceId: string; parentSpanId: string } | null {
  if (!traceparent?.startsWith('00-')) {
    return null;
  }

  const segments = traceparent.split('-');
  if (segments.length !== 4) {
    return null;
  }

  const [, traceId, spanId, flags] = segments;

  // Validate hex format
  if (!/^[0-9a-f]{32}$/i.test(traceId) || !/^[0-9a-f]{16}$/i.test(spanId)) {
    return null;
  }

  return { traceId, parentSpanId: spanId };
}

/**
 * Generate deterministic trace/span IDs when header is missing
 */
function generateTraceIds(): { traceId: string; spanId: string } {
  const timestamp = Date.now().toString(16).padStart(16, '0');
  const entropy = Math.random().toString(16).substring(2, 10).padStart(8, '0');

  return {
    traceId: (timestamp + entropy).substring(0, 32).padEnd(32, '0'),
    spanId: `spn${Date.now()}`.substring(0, 16).padEnd(16, '0')
  };
}

/**
 * Governance Trace Middleware
 *
 * Intercepts all requests at the Express edge.
 * Establishes W3C-compliant trace context for the entire request scope.
 */
export function governanceTraceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const traceparent = req.headers['traceparent'] as string | undefined;
  const correlationId = req.headers['x-correlation-id'] as string | undefined;
  const executionContext = (req.headers['x-execution-context'] || 'PRODUCTION') as
    | 'PRODUCTION'
    | 'SANDBOX'
    | 'SIMULATION';
  const executionClass = (req.headers['x-execution-class'] || 'DIRECT_MUTATION') as ExecutionClass;

  // Parse or generate trace IDs
  let traceId: string;
  let parentSpanId: string | null = null;

  const parsed = parseTraceparent(traceparent);
  if (parsed) {
    traceId = parsed.traceId;
    parentSpanId = parsed.parentSpanId;
  } else {
    const generated = generateTraceIds();
    traceId = generated.traceId;
  }

  // Generate local span for this service
  const localSpanId = `spn${Date.now()}`.substring(0, 16).padEnd(16, '0');

  // Construct context
  const context: GovernanceRequestContext = {
    traceId,
    spanId: localSpanId,
    parentSpanId,
    correlationId: correlationId || `corr_${Date.now()}`,
    executionContext,
    executionClass,
    topologyHash: SYSTEM_TOPOLOGY_HASH,
    requestTimestamp: Date.now()
  };

  // Attach to request for downstream handlers
  (req as any).governanceContext = context;

  // Propagate trace headers to response
  res.setHeader('X-Trace-ID', context.traceId);
  res.setHeader('X-Span-ID', context.spanId);
  res.setHeader('X-Topology-Hash', context.topologyHash);

  // Continue to next middleware
  next();
}

/**
 * Update active system topology
 * Called during rolling deployments to shift to new schema/route manifests
 */
export function updateSystemTopology(newTopologyHash: string) {
  (global as any).SYSTEM_TOPOLOGY_HASH = newTopologyHash;
}

/**
 * Retrieve current context from request
 * Utility for downstream services that need trace/execution metadata
 */
export function getGovernanceContext(req: Request): GovernanceRequestContext {
  const context = (req as any).governanceContext;
  if (!context) {
    throw new Error('GovernanceRequestContext not found - middleware not installed');
  }
  return context;
}
