/**
 * GET /api/governance/metrics/export
 *
 * Exports platform operational metrics in JSON or CSV format.
 * Intended for operator dashboards, alerting integrations, and CI gate checks.
 *
 * Query params:
 *   format      "json" | "csv"    — default: json
 *   hours       number            — lookback hours (default: 24, max: 720 = 30 days)
 *   tenant_id   string            — scope to tenant; omit for all
 *   include     string            — comma-separated metric names to include; default: all platform.*
 *
 * Response headers (JSON):
 *   Content-Type: application/json
 *
 * Response headers (CSV):
 *   Content-Type: text/csv
 *   Content-Disposition: attachment; filename="governance-metrics-<timestamp>.csv"
 */

import { NextRequest, NextResponse } from 'next/server';
import { query as dbQuery } from '../../../../../../../core/database/connection';

const DEFAULT_METRICS = [
  'platform.bronze_extraction.duration_ms',
  'platform.silver_normalization.duration_ms',
  'platform.gold_scoring.duration_ms',
  'platform.pipeline_run.duration_ms',
  'governance.policy_eval.duration_ms',
  'governance.audit_write.failure',
  'governance.approval_queue_depth',
  'llm.inference.duration_ms',
  'llm.fallback.count',
  'splunk.mcp.duration_ms',
  'splunk.budget.violation_count',
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);

    const format   = searchParams.get('format') === 'csv' ? 'csv' : 'json';
    const tenantId = searchParams.get('tenant_id') ?? undefined;

    const rawHours = parseInt(searchParams.get('hours') ?? '24', 10);
    const hours    = Math.min(Math.max(rawHours, 1), 720);

    const includeParam = searchParams.get('include');
    const metrics      = includeParam
      ? includeParam.split(',').map(m => m.trim()).filter(Boolean)
      : DEFAULT_METRICS;

    const params: unknown[] = [hours, metrics];
    let tenantFilter = '';
    if (tenantId) {
      params.push(tenantId);
      tenantFilter = ` AND (tenant_id = $${params.length} OR tenant_id IS NULL)`;
    }

    const result = await dbQuery<{
      id:          string;
      metric_name: string;
      value:       number;
      unit:        string;
      tenant_id:   string | null;
      environment: string;
      metric_window: string | null;
      tags:        Record<string, unknown>;
      recorded_at: Date;
    }>(
      `SELECT id, metric_name, value, unit, tenant_id, environment, metric_window, tags, recorded_at
       FROM governance_operational_metrics
       WHERE recorded_at > NOW() - ($1 || ' hours')::INTERVAL
         AND metric_name = ANY($2::text[])
         ${tenantFilter}
       ORDER BY recorded_at DESC
       LIMIT 10000`,
      params,
    );

    const rows = result.rows;

    if (format === 'csv') {
      const header = 'id,metric_name,value,unit,tenant_id,environment,metric_window,recorded_at,tags\n';
      const body   = rows.map(r => [
        r.id,
        r.metric_name,
        r.value,
        r.unit,
        r.tenant_id ?? '',
        r.environment,
        r.metric_window ?? '',
        r.recorded_at.toISOString(),
        JSON.stringify(r.tags ?? {}),
      ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      return new NextResponse(header + body, {
        status: 200,
        headers: {
          'Content-Type':        'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="governance-metrics-${timestamp}.csv"`,
          'Cache-Control':       'no-store',
        },
      });
    }

    // JSON format — include summary stats per metric
    const byMetric: Record<string, {
      count:   number;
      values:  number[];
      unit:    string;
      latest?: string;
    }> = {};

    for (const row of rows) {
      if (!byMetric[row.metric_name]) {
        byMetric[row.metric_name] = { count: 0, values: [], unit: row.unit };
      }
      byMetric[row.metric_name].count++;
      byMetric[row.metric_name].values.push(row.value);
      if (!byMetric[row.metric_name].latest) {
        byMetric[row.metric_name].latest = row.recorded_at.toISOString();
      }
    }

    const summary = Object.entries(byMetric).map(([name, data]) => {
      const sorted = [...data.values].sort((a, b) => a - b);
      const p = (pct: number) => sorted.length
        ? sorted[Math.min(Math.floor(pct / 100 * sorted.length), sorted.length - 1)]
        : 0;
      return {
        metricName: name,
        unit:       data.unit,
        count:      data.count,
        latest:     data.latest ?? null,
        avg:        data.values.length
          ? Math.round(data.values.reduce((a, b) => a + b, 0) / data.values.length * 100) / 100
          : 0,
        p50:  p(50),
        p95:  p(95),
        p99:  p(99),
        min:  sorted[0]             ?? 0,
        max:  sorted[sorted.length - 1] ?? 0,
      };
    });

    return NextResponse.json(
      {
        exportedAt:    new Date().toISOString(),
        lookbackHours: hours,
        tenantId:      tenantId ?? null,
        totalRows:     rows.length,
        metrics:       summary,
        raw:           rows.map(r => ({
          id:          r.id,
          metricName:  r.metric_name,
          value:       r.value,
          unit:        r.unit,
          tenantId:    r.tenant_id,
          environment: r.environment,
          metricWindow: r.metric_window,
          recordedAt:  r.recorded_at.toISOString(),
          tags:        r.tags ?? {},
        })),
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );

  } catch (err) {
    console.error('[metrics/export] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
