/**
 * DISTRIBUTED TRACER
 * OpenTelemetry wiring for agentic platform
 * Enables end-to-end observability: why did this decision happen?
 */

import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { context, trace, Span, SpanStatusCode } from '@opentelemetry/api';

/**
 * Global tracer instance
 */
let tracerInstance: any;

/**
 * Initialize OTEL tracing
 */
export function initializeTracer(
  serviceName: string = 'governance-platform',
  otlpEndpoint: string = 'http://localhost:4318'
): void {
  const provider = new NodeTracerProvider({
    sampler: new TraceIdRatioBasedSampler(1.0), // 100% sampling (adjust in prod)
    resource: {
      attributes: {
        'service.name': serviceName,
        'service.version': '1.0.0',
      },
    },
  });

  // Export to OTLP collector (Jaeger/Datadog/etc)
  const otlpExporter = new OTLPTraceExporter({
    url: otlpEndpoint + '/v1/traces',
  });

  provider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));

  // Also log to console in dev
  if (process.env.NODE_ENV === 'development') {
    provider.addSpanProcessor(new BatchSpanProcessor(new ConsoleSpanExporter()));
  }

  provider.register();
  tracerInstance = trace.getTracer(serviceName);

  console.log(`[Tracer] Initialized: ${serviceName} → ${otlpEndpoint}`);
}

/**
 * Get global tracer
 */
export function getTracer() {
  if (!tracerInstance) {
    console.warn('[Tracer] Tracer not initialized, using no-op');
    tracerInstance = trace.getTracer('uninitialized');
  }
  return tracerInstance;
}

/**
 * Start a span with context propagation
 */
export function startSpan(name: string, attributes?: Record<string, any>): { span: Span; context: any } {
  const tracer = getTracer();

  const span = tracer.startSpan(name, {
    attributes: {
      'span.type': 'operation',
      ...attributes,
    },
  });

  const ctx = trace.setSpan(context.active(), span);

  return { span, context: ctx };
}

/**
 * End span with status
 */
export function endSpan(span: Span, status: 'success' | 'error' = 'success', error?: Error): void {
  if (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

/**
 * Run function within span context
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span, ctx: any) => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const { span, context: ctx } = startSpan(name, attributes);

  try {
    const result = await context.with(ctx, async () => {
      return await fn(span, ctx);
    });
    endSpan(span, 'success');
    return result;
  } catch (err) {
    endSpan(span, 'error', err as Error);
    throw err;
  }
}

/**
 * Inject trace context into object (for serialization)
 */
export function injectTraceContext(obj: any): any {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) return obj;

  const spanContext = activeSpan.spanContext();
  return {
    ...obj,
    _trace: {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
    },
  };
}

/**
 * Extract trace context from object (for job processing)
 */
export function extractTraceContext(obj: any): { traceId?: string; spanId?: string } {
  return {
    traceId: obj?._trace?.traceId,
    spanId: obj?._trace?.spanId,
  };
}

/**
 * Add event to span
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, any>
): void {
  span.addEvent(name, attributes);
}

/**
 * Set span attribute
 */
export function setSpanAttribute(
  span: Span,
  key: string,
  value: string | number | boolean | string[] | number[]
): void {
  span.setAttribute(key, value);
}
