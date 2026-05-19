/**
 * OBSERVABILITY LAYER
 * End-to-end tracing, correlation IDs, metrics
 */

export { initializeTracer, getTracer, startSpan, endSpan, withSpan, injectTraceContext, extractTraceContext, addSpanEvent, setSpanAttribute } from './tracer';

export { createRootContext, createChildContext, attachContext, extractContext, logWithContext, getTraceLink, getElapsedMs, summarizeCorrelation, type CorrelationContext } from './correlation';

export { initializeMetrics, getMeter, JobMetrics, QueueMetrics, DecisionMetrics, jobMetrics, queueMetrics, decisionMetrics } from './metrics';
