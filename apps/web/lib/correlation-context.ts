'use server';

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Correlation Context — Distributed tracing context for governance decisions
 *
 * Enables tracking of decision causality across async boundaries:
 * - SSE streaming
 * - Queue processing
 * - API requests
 * - Task retry chains
 *
 * Each governance action gets a unique correlationId that propagates through
 * all related operations, creating a traceable "chain" of causality.
 */

export interface CorrelationContext {
  correlationId: string;
  parentDecisionId?: string;
  parentTraceId?: string;
  startTime: number;
  operatorEmail?: string;
}

// AsyncLocalStorage preserves context across async calls
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Generate a correlation ID (UUID format)
 */
export function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Set the current correlation context
 */
export function setCorrelationContext(context: Partial<CorrelationContext>): CorrelationContext {
  const existing = correlationStorage.getStore();
  const newContext: CorrelationContext = {
    correlationId: existing?.correlationId || generateCorrelationId(),
    parentDecisionId: context.parentDecisionId || existing?.parentDecisionId,
    parentTraceId: context.parentTraceId || existing?.parentTraceId,
    startTime: context.startTime || Date.now(),
    operatorEmail: context.operatorEmail || existing?.operatorEmail,
  };

  return correlationStorage.run(newContext, () => newContext);
}

/**
 * Get the current correlation context
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * Get just the correlation ID (or generate new if not set)
 */
export function getCorrelationId(): string {
  const context = correlationStorage.getStore();
  return context?.correlationId || generateCorrelationId();
}

/**
 * Run a function within a correlation context
 */
export async function runWithCorrelation<T>(
  fn: () => T | Promise<T>,
  context?: Partial<CorrelationContext>
): Promise<T> {
  const existing = correlationStorage.getStore();
  const newContext: CorrelationContext = {
    correlationId: existing?.correlationId || generateCorrelationId(),
    parentDecisionId: context?.parentDecisionId || existing?.parentDecisionId,
    parentTraceId: context?.parentTraceId || existing?.parentTraceId,
    startTime: context?.startTime || Date.now(),
    operatorEmail: context?.operatorEmail || existing?.operatorEmail,
  };

  return new Promise((resolve, reject) => {
    correlationStorage.run(newContext, async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Extract correlation context from headers (for SSE, API responses, etc.)
 */
export function extractFromHeaders(headers: Record<string, string>): Partial<CorrelationContext> {
  return {
    correlationId: headers['x-correlation-id'] || headers['x-trace-id'],
    parentDecisionId: headers['x-parent-decision-id'],
    parentTraceId: headers['x-parent-trace-id'],
    operatorEmail: headers['x-operator-email'],
  };
}

/**
 * Inject correlation context into headers
 */
export function injectToHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const context = correlationStorage.getStore();
  if (!context) return headers;

  return {
    ...headers,
    'x-correlation-id': context.correlationId,
    'x-parent-decision-id': context.parentDecisionId || '',
    'x-parent-trace-id': context.parentTraceId || '',
    'x-operator-email': context.operatorEmail || '',
  };
}

/**
 * Get correlation duration (time since start)
 */
export function getCorrelationDuration(): number {
  const context = correlationStorage.getStore();
  return context ? Date.now() - context.startTime : 0;
}
