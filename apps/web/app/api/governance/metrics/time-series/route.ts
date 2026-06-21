/**
 * GET /api/governance/metrics/time-series
 *
 * Returns time-series data for platform operational metrics.
 * All metrics are tagged component=platform; customer data is never exposed.
 *
 * Query params:
 *   metric      string   required  — metric name (e.g. "platform.bronze_extraction.duration_ms")
 *   hours       number   optional  — lookback window in hours (default: 24, max: 168)
 *   tenant_id   string   optional  — scope to tenant; omit for platform-wide
 *   window      string   optional  — aggregation window: "5m" | "1h" | "24h"
 *   limit       number   optional  — max data points (default: 500, max: 2000)
 *
 * Also accepts:
 *   metric=violations — returns active SLO violations instead of metric time-series
 *   metric=slos       — returns configured SLO definitions
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  queryTimeSeries,
  queryActiveViolations,
  type MetricWindow,
} from '../../../../../../core/telemetry/otel-instrumentation';
import { query as dbQuery } from '../../../../../../core/database/connection';

// Available platform metrics (allow-list — never exposes customer data names)
const ALLOWED_METRICS = new Set([
  // Pipeline stages
  'platform.bronze_extraction.duration_ms',
  'platform.silver_normalization.duration_ms',
  'platform.gold_scoring.duration_ms',
  'platform.snapshot_materialization.duration_ms',
  'platform.pipeline_run.duration_ms',
  'platform.watermark_advance.duration_ms',
  'platform.bronze_extraction.throughput',
  'platform.silver_normalization.throughput',
  'platform.gold_scoring.throughput',
  // Governance
  'governance.policy_eval.duration_ms',
  'governance.audit_write.success',
  'governance.audit_write.failure',
  'governance.approval_queue_depth',
  // LLM
  'llm.inference.duration_ms',
  'llm.inference.total_tokens',
  'llm.inference.cost_estimate',
  'llm.fallback.count',
  // Splunk
  'splunk.mcp.duration_ms',
  'splunk.circuit_breaker.state_change',
  'splunk.budget.violation_count',
  // Special virtual metrics
  'violations',
  'slos',
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);

    const metric   = searchParams.get('metric');
    const tenantId = searchParams.get('tenant_id') ?? undefined;
    const window   = (searchParams.get('window') ?? undefined) as MetricWindow | undefined;

    const rawHours = parseInt(searchParams.get('hours') ?? '24', 10);
    const hours    = Math.min(Math.max(rawHours, 1), 168);

    const rawLimit = parseInt(searchParams.get('limit') ?? '500', 10);
    const limit    = Math.min(Math.max(rawLimit, 1), 2000);

    if (!metric) {
      return NextResponse.json(
        { error: 'metric query param is required' },
        { status: 400 },
      );
    }

    if (!ALLOWED_METRICS.has(metric)) {
      return NextResponse.json(
        { error: `Unknown metric: ${metric}`, allowed: Array.from(ALLOWED_METRICS) },
        { status: 400 },
      );
    }

    // Virtual: active SLO violations
    if (metric === 'violations') {
      const violations = await queryActiveViolations({ tenantId, limit });
      return NextResponse.json({
        metric:     'violations',
        tenantId:   tenantId ?? null,
        violations,
        count:      violations.length,
        generatedAt: new Date().toISOString(),
      });
    }

    // Virtual: SLO definitions
    if (metric === 'slos') {
      const rows = await dbQuery(
        `SELECT id, metric_name, description, expected_min, expected_max,
                violation_threshold, enforcement_mode, is_active, created_at
         FROM data_quality_slos
         WHERE is_active = true
         ORDER BY metric_name`,
      );
      return NextResponse.json({
        metric:      'slos',
        slos:        rows.rows,
        count:       rows.rowCount,
        generatedAt: new Date().toISOString(),
      });
    }

    // Standard time-series query
    const series = await queryTimeSeries({
      metricName:    metric,
      lookbackHours: hours,
      tenantId,
      window,
      limit,
    });

    // Compute simple aggregates for convenience
    const values       = series.dataPoints.map(d => d.value);
    const avg          = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const p50          = percentile(values, 50);
    const p95          = percentile(values, 95);
    const p99          = percentile(values, 99);

    return NextResponse.json({
      metric,
      unit:        series.unit,
      tenantId:    tenantId ?? null,
      lookbackHours: hours,
      window:      window ?? null,
      count:       series.dataPoints.length,
      aggregates:  { avg, p50, p95, p99 },
      dataPoints:  series.dataPoints,
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[metrics/time-series] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: (err as Error).message },
      { status: 500 },
    );
  }
}

function percentile(sorted: number[], pct: number): number {
  if (!sorted.length) return 0;
  const arr = [...sorted].sort((a, b) => a - b);
  const idx = Math.floor((pct / 100) * arr.length);
  return arr[Math.min(idx, arr.length - 1)];
}
