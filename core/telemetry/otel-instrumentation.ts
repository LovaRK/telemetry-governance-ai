/**
 * OTel Instrumentation — Phase 11
 *
 * Internal platform observability using OpenTelemetry-compatible span/metric
 * emission. All spans and metrics are tagged component=platform to distinguish
 * platform telemetry from customer telemetry (component=customer).
 *
 * CRITICAL NAMESPACE SEPARATION:
 *   platform.*   — pipeline stages, governance, LLM, scoring
 *   customer.*   — customer index/sourcetype data (NEVER emitted here)
 *   governance.* — policy engine, approvals, audit
 *   llm.*        — LLM routing, tokens, costs, fallbacks
 *   splunk.*     — MCP latency, circuit breaker state
 *
 * This module is database-backed for persistence; true OTel SDK integration
 * can be wired up by pointing the exporter at a collector endpoint.
 *
 * Usage:
 *   import { platform, governance, llm, splunk } from 'core/telemetry/otel-instrumentation';
 *   const span = platform.startSpan('bronze_extraction', { tenant_id });
 *   try { ... span.ok(); } catch (e) { span.error(e); }
 */

import * as crypto from 'crypto';
import { query as dbQuery } from '../database/connection';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MetricUnit = 'ms' | 'count' | 'percent' | 'hours' | 'gb' | 'rows_per_sec';
export type MetricWindow = '5m' | '1h' | '24h' | null;

export interface SpanContext {
  traceId:    string;
  spanId:     string;
  startedAt:  number;   // Date.now()
  component:  string;
  operation:  string;
  tenantId?:  string;
  tags:       Record<string, string | number | boolean>;
}

export interface CompletedSpan extends SpanContext {
  durationMs: number;
  status:     'ok' | 'error';
  error?:     string;
  endedAt:    number;
}

export interface OtelSpan {
  context:    SpanContext;
  ok:         () => CompletedSpan;
  error:      (err: Error | string) => CompletedSpan;
  addTag:     (key: string, value: string | number | boolean) => OtelSpan;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process span collector (no-alloc ring buffer — max 2000 spans in memory)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SPAN_BUFFER = 2000;
const spanBuffer: CompletedSpan[] = [];

function recordSpan(span: CompletedSpan): void {
  if (spanBuffer.length >= MAX_SPAN_BUFFER) {
    spanBuffer.shift(); // drop oldest
  }
  spanBuffer.push(span);

  // Async DB persist — fire-and-forget, never blocks hot path
  void persistSpanMetric(span).catch(() => { /* silent */ });
}

export function getRecentSpans(limit = 100): CompletedSpan[] {
  return spanBuffer.slice(-limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core span builder
// ─────────────────────────────────────────────────────────────────────────────

function createSpan(
  component: string,
  operation: string,
  tags: Record<string, string | number | boolean> = {},
): OtelSpan {
  const traceId   = crypto.randomBytes(16).toString('hex');
  const spanId    = crypto.randomBytes(8).toString('hex');
  const startedAt = Date.now();

  const context: SpanContext = {
    traceId,
    spanId,
    startedAt,
    component,
    operation,
    tenantId: tags['tenant_id'] as string | undefined,
    tags: { ...tags, component },
  };

  const finish = (status: 'ok' | 'error', errorMsg?: string): CompletedSpan => {
    const endedAt    = Date.now();
    const durationMs = endedAt - startedAt;
    const completed: CompletedSpan = {
      ...context,
      durationMs,
      status,
      error: errorMsg,
      endedAt,
    };
    recordSpan(completed);
    return completed;
  };

  const span: OtelSpan = {
    context,
    ok:    () => finish('ok'),
    error: (err) => finish('error', err instanceof Error ? err.message : String(err)),
    addTag: (key, value) => {
      context.tags[key] = value;
      return span;
    },
  };

  return span;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB persistence — writes to governance_operational_metrics
// ─────────────────────────────────────────────────────────────────────────────

async function persistSpanMetric(span: CompletedSpan): Promise<void> {
  try {
    const id = `otel-${span.spanId}-${span.endedAt}`;

    await dbQuery(
      `INSERT INTO governance_operational_metrics
         (id, metric_name, value, unit, tenant_id, environment, metric_window, tags, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        `${span.component}.${span.operation}.duration_ms`,
        span.durationMs,
        'ms',
        span.tenantId ?? null,
        process.env.APP_ENV ?? 'sandbox',
        JSON.stringify({
          ...span.tags,
          status:   span.status,
          trace_id: span.traceId,
          span_id:  span.spanId,
          error:    span.error ?? null,
        }),
      ],
    );
  } catch {
    // DB may not be available — silently swallow, never crash the hot path
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric recorder (for point-in-time gauge/counter values, not spans)
// ─────────────────────────────────────────────────────────────────────────────

export async function recordMetric(
  metricName: string,
  value: number,
  unit: MetricUnit,
  opts: {
    tenantId?:  string;
    window?:    MetricWindow;
    tags?:      Record<string, string | number | boolean>;
  } = {},
): Promise<void> {
  try {
    const id  = `metric-${crypto.randomBytes(8).toString('hex')}-${Date.now()}`;

    await dbQuery(
      `INSERT INTO governance_operational_metrics
         (id, metric_name, value, unit, tenant_id, environment, metric_window, tags, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
      [
        id,
        metricName,
        value,
        unit,
        opts.tenantId ?? null,
        process.env.APP_ENV ?? 'sandbox',
        opts.window ?? null,
        JSON.stringify(opts.tags ?? {}),
      ],
    );
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SLO violation recorder
// ─────────────────────────────────────────────────────────────────────────────

export async function recordSloViolation(opts: {
  sloId:           string;
  metricName:      string;
  observedValue:   number;
  thresholdValue:  number;
  enforcementMode: string;
  tenantId?:       string;
  context?:        Record<string, unknown>;
}): Promise<void> {
  try {
    const id = `slov-${crypto.randomBytes(8).toString('hex')}-${Date.now()}`;

    await dbQuery(
      `INSERT INTO data_quality_violation_log
         (id, slo_id, tenant_id, metric_name, observed_value, threshold_value, enforcement_mode, context, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
      [
        id,
        opts.sloId,
        opts.tenantId ?? null,
        opts.metricName,
        opts.observedValue,
        opts.thresholdValue,
        opts.enforcementMode,
        JSON.stringify(opts.context ?? {}),
      ],
    );

    // Log to console for immediate visibility
    console.warn(
      `[OTel] SLO VIOLATION ${opts.enforcementMode}: ${opts.metricName} = ${opts.observedValue} ` +
      `(threshold: ${opts.thresholdValue})`,
    );
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespaced span factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * platform.* — Bronze/Silver/Gold pipeline stages, scoring, normalization
 */
export const platform = {
  startSpan: (
    operation: 'bronze_extraction' | 'silver_normalization' | 'gold_scoring' |
               'snapshot_materialization' | 'watermark_advance' | 'pipeline_run',
    tags: Record<string, string | number | boolean> = {},
  ): OtelSpan => createSpan('platform', operation, tags),

  recordThroughput: (rowsPerSec: number, stage: string, tenantId?: string) =>
    recordMetric(`platform.${stage}.throughput`, rowsPerSec, 'rows_per_sec', { tenantId }),

  recordLatency: (durationMs: number, stage: string, tenantId?: string) =>
    recordMetric(`platform.${stage}.duration_ms`, durationMs, 'ms', { tenantId }),
};

/**
 * governance.* — Policy engine, approvals, audit writes, freeze events
 */
export const governance = {
  startSpan: (
    operation: 'policy_eval' | 'approval_request' | 'approval_resolve' |
               'audit_write' | 'freeze_activate' | 'freeze_release' | 'ttl_check' | 'revocation',
    tags: Record<string, string | number | boolean> = {},
  ): OtelSpan => createSpan('governance', operation, tags),

  recordPolicyEval: (
    matched: boolean,
    policyId: string,
    durationMs: number,
    tenantId?: string,
  ) => recordMetric('governance.policy_eval.duration_ms', durationMs, 'ms', {
    tenantId,
    tags: { policy_id: policyId, matched: String(matched) },
  }),

  recordAuditWrite: (success: boolean, tenantId?: string) =>
    recordMetric(
      success ? 'governance.audit_write.success' : 'governance.audit_write.failure',
      1, 'count', { tenantId },
    ),

  recordApprovalQueueDepth: (depth: number, tenantId?: string) =>
    recordMetric('governance.approval_queue_depth', depth, 'count', { tenantId }),
};

/**
 * llm.* — Provider calls, token usage, costs, fallbacks
 */
export const llm = {
  startSpan: (
    operation: 'inference' | 'embedding' | 'feature_resolution' | 'template_render',
    tags: Record<string, string | number | boolean> = {},
  ): OtelSpan => createSpan('llm', operation, tags),

  recordInference: (opts: {
    provider:       string;
    model:          string;
    promptTokens:   number;
    completionTokens: number;
    durationMs:     number;
    costEstimate:   number;
    fallbackUsed:   boolean;
    tenantId?:      string;
  }) => Promise.all([
    recordMetric('llm.inference.duration_ms', opts.durationMs, 'ms', {
      tenantId: opts.tenantId,
      tags: { provider: opts.provider, model: opts.model, fallback: String(opts.fallbackUsed) },
    }),
    recordMetric('llm.inference.total_tokens', opts.promptTokens + opts.completionTokens, 'count', {
      tenantId: opts.tenantId,
      tags: { provider: opts.provider, model: opts.model },
    }),
    recordMetric('llm.inference.cost_estimate', opts.costEstimate, 'count', {
      tenantId: opts.tenantId,
      tags: { provider: opts.provider, model: opts.model },
    }),
    opts.fallbackUsed
      ? recordMetric('llm.fallback.count', 1, 'count', { tenantId: opts.tenantId })
      : Promise.resolve(),
  ]),

  recordFallback: (reason: string, tenantId?: string) =>
    recordMetric('llm.fallback.count', 1, 'count', {
      tenantId,
      tags: { reason },
    }),
};

/**
 * splunk.* — MCP latency, circuit breaker state, SID jobs, query budget
 */
export const splunk = {
  startSpan: (
    operation: 'mcp_query' | 'sid_create' | 'sid_poll' | 'sid_results' |
               'circuit_breaker_trip' | 'budget_check' | 'tstats_query',
    tags: Record<string, string | number | boolean> = {},
  ): OtelSpan => createSpan('splunk', operation, tags),

  recordMcpLatency: (durationMs: number, circuitState: string, tenantId?: string) =>
    recordMetric('splunk.mcp.duration_ms', durationMs, 'ms', {
      tenantId,
      tags: { circuit_state: circuitState },
    }),

  recordCircuitBreaker: (state: string, tenantId?: string) =>
    recordMetric('splunk.circuit_breaker.state_change', 1, 'count', {
      tenantId,
      tags: { state },
    }),

  recordQueryBudgetViolation: (tenantId: string, scanGb: number, limitGb: number) => {
    void recordSloViolation({
      sloId:           'slo-ingestion-completeness', // closest built-in SLO
      metricName:      'query_budget_scan_gb',
      observedValue:   scanGb,
      thresholdValue:  limitGb,
      enforcementMode: 'WARN',
      tenantId,
      context:         { scan_gb: scanGb, limit_gb: limitGb },
    });
    return recordMetric('splunk.budget.violation_count', 1, 'count', { tenantId });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Metrics query helpers (used by the time-series API route)
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricTimeSeries {
  metricName:  string;
  unit:        string;
  dataPoints:  Array<{ recordedAt: string; value: number; tags: Record<string, unknown> }>;
}

export async function queryTimeSeries(opts: {
  metricName:  string;
  lookbackHours: number;
  tenantId?:   string;
  window?:     MetricWindow;
  limit?:      number;
}): Promise<MetricTimeSeries> {
  const params: unknown[] = [
    opts.metricName,
    opts.lookbackHours,
  ];
  let where = `metric_name = $1 AND recorded_at > NOW() - ($2 || ' hours')::INTERVAL`;

  if (opts.tenantId) {
    params.push(opts.tenantId);
    where += ` AND (tenant_id = $${params.length} OR tenant_id IS NULL)`;
  }
  if (opts.window) {
    params.push(opts.window);
    where += ` AND metric_window = $${params.length}`;
  }

  params.push(opts.limit ?? 500);
  const limitClause = `LIMIT $${params.length}`;

  const result = await dbQuery<{
    recorded_at: Date;
    value: number;
    unit: string;
    tags: Record<string, unknown>;
  }>(
    `SELECT recorded_at, value, unit, tags
     FROM governance_operational_metrics
     WHERE ${where}
     ORDER BY recorded_at DESC
     ${limitClause}`,
    params,
  );

  return {
    metricName:  opts.metricName,
    unit:        result.rows[0]?.unit ?? 'count',
    dataPoints:  result.rows.map((r: { recorded_at: Date; value: number; unit: string; tags: Record<string, unknown> }) => ({
      recordedAt: r.recorded_at.toISOString(),
      value:      r.value,
      tags:       r.tags ?? {},
    })),
  };
}

export async function queryActiveViolations(opts: {
  tenantId?: string;
  limit?:    number;
}): Promise<Array<{
  id:              string;
  sloId:           string;
  metricName:      string;
  observedValue:   number;
  thresholdValue:  number;
  enforcementMode: string;
  createdAt:       string;
  context:         Record<string, unknown>;
}>> {
  const params: unknown[] = [];
  let where = 'resolved_at IS NULL';

  if (opts.tenantId) {
    params.push(opts.tenantId);
    where += ` AND (tenant_id = $${params.length} OR tenant_id IS NULL)`;
  }

  params.push(opts.limit ?? 50);

  type ViolationRow = {
    id: string; slo_id: string; metric_name: string; observed_value: number;
    threshold_value: number; enforcement_mode: string; created_at: Date; context: Record<string, unknown>;
  };

  const result = await dbQuery<ViolationRow>(
    `SELECT id, slo_id, metric_name, observed_value, threshold_value,
            enforcement_mode, created_at, context
     FROM data_quality_violation_log
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return result.rows.map((r: ViolationRow) => ({
    id:              r.id,
    sloId:           r.slo_id,
    metricName:      r.metric_name,
    observedValue:   r.observed_value,
    thresholdValue:  r.threshold_value,
    enforcementMode: r.enforcement_mode,
    createdAt:       r.created_at.toISOString(),
    context:         r.context ?? {},
  }));
}
