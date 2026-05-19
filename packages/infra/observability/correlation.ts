/**
 * TRACE CORRELATION
 * Propagates trace IDs across pipeline stages
 * Critical: INGESTION → SCORING → POLICY → AGENT → KPI all share same traceId
 */

import { v4 as uuid } from 'uuid';
import { trace, context } from '@opentelemetry/api';

/**
 * Correlation context (attached to every job)
 */
export interface CorrelationContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  tenantId: string;
  snapshotId: string;
  stageName: string;
  startTime: Date;
  jobId: string;
}

/**
 * Create root correlation context
 */
export function createRootContext(
  tenantId: string,
  snapshotId: string
): CorrelationContext {
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan?.spanContext();

  return {
    traceId: spanContext?.traceId || uuid(),
    spanId: uuid(),
    tenantId,
    snapshotId,
    stageName: 'ROOT',
    startTime: new Date(),
    jobId: `${snapshotId}:root`,
  };
}

/**
 * Create child context (next stage in pipeline)
 */
export function createChildContext(
  parent: CorrelationContext,
  stageName: string
): CorrelationContext {
  return {
    ...parent,
    spanId: uuid(),
    parentSpanId: parent.spanId,
    stageName,
    startTime: new Date(),
    jobId: `${parent.snapshotId}:${stageName}:${Date.now()}`,
  };
}

/**
 * Attach context to job payload
 */
export function attachContext<T>(payload: T, correlation: CorrelationContext): T & { _correlation: CorrelationContext } {
  return {
    ...payload,
    _correlation: correlation,
  };
}

/**
 * Extract context from job payload
 */
export function extractContext(payload: any): CorrelationContext | null {
  return payload?._correlation || null;
}

/**
 * Log with correlation context
 */
export function logWithContext(
  message: string,
  correlation: CorrelationContext,
  level: 'info' | 'warn' | 'error' = 'info'
): void {
  const log = {
    timestamp: new Date().toISOString(),
    level,
    message,
    traceId: correlation.traceId,
    spanId: correlation.spanId,
    tenantId: correlation.tenantId,
    snapshotId: correlation.snapshotId,
    stage: correlation.stageName,
    jobId: correlation.jobId,
  };

  const logFn = console[level] || console.log;
  logFn(JSON.stringify(log));
}

/**
 * Get trace link (for Jaeger/Datadog UI)
 */
export function getTraceLink(
  correlation: CorrelationContext,
  jaegerUrl: string = 'http://localhost:16686'
): string {
  return `${jaegerUrl}/trace/${correlation.traceId}`;
}

/**
 * Calculate duration from correlation start
 */
export function getElapsedMs(correlation: CorrelationContext): number {
  return Date.now() - correlation.startTime.getTime();
}

/**
 * Build correlation summary
 */
export function summarizeCorrelation(correlation: CorrelationContext): {
  traceUrl: string;
  summary: string;
} {
  const elapsed = getElapsedMs(correlation);
  return {
    traceUrl: getTraceLink(correlation),
    summary: `[${correlation.stageName}] trace=${correlation.traceId.slice(0, 8)}... snapshot=${correlation.snapshotId} elapsed=${elapsed}ms`,
  };
}
