/**
 * Governance Self-Observability — Phase 13
 *
 * Collects platform operational health metrics and writes them to
 * governance_operational_metrics for operator visibility.
 *
 * The 9 tracked metrics (from the architecture plan):
 *  1. policy_eval_latency          — per-evaluation latency histogram
 *  2. approval_queue_depth         — pending approvals at any moment
 *  3. audit_write_failure_rate     — rolling 5m failure %
 *  4. llm_fallback_rate            — % requests that fell back to Anthropic
 *  5. mcp_timeout_rate             — % MCP calls that timed out
 *  6. snapshot_materialization_latency — Bronze→Gold pipeline latency
 *  7. query_budget_violations      — budget limit trigger counts
 *  8. parser_failure_rate          — % SPL with confidence < 0.5
 *  9. watermark_staleness          — hours since last watermark advance
 *
 * Usage:
 *   const collector = new GovernanceSelfObservabilityCollector();
 *   collector.start(300_000); // collect every 5 minutes
 *   collector.stop();
 *
 * Can also be called once:
 *   await collector.collect();
 */

import { recordMetric, recordSloViolation } from '../../../core/telemetry/otel-instrumentation';
import { query as dbQuery } from '../../../core/database/connection';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfObservabilitySnapshot {
  collectedAt:                   string;
  policyEvalLatencyMs?:          number;  // avg of last 5m
  approvalQueueDepth?:           number;
  auditWriteFailureRatePct?:     number;
  llmFallbackRatePct?:           number;
  mcpTimeoutRatePct?:            number;
  snapshotMaterializationMs?:    number;  // avg latency
  queryBudgetViolations?:        number;  // count in window
  parserFailureRatePct?:         number;
  watermarkStalenessHours?:      number;
  errors:                        string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Collector
// ─────────────────────────────────────────────────────────────────────────────

export class GovernanceSelfObservabilityCollector {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly windowMinutes = 5;

  /**
   * Start periodic collection.
   * @param intervalMs  Milliseconds between collections (default: 5 minutes)
   */
  start(intervalMs = 5 * 60_000): void {
    if (this.intervalHandle) return; // already running

    // Collect once immediately, then on interval
    void this.collect().catch(err =>
      console.warn('[SelfObservability] Initial collection failed:', err.message),
    );

    this.intervalHandle = setInterval(() => {
      void this.collect().catch(err =>
        console.warn('[SelfObservability] Collection failed:', err.message),
      );
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async collect(): Promise<SelfObservabilitySnapshot> {
    const snapshot: SelfObservabilitySnapshot = {
      collectedAt: new Date().toISOString(),
      errors:      [],
    };

    await Promise.all([
      this.collectPolicyEvalLatency(snapshot),
      this.collectApprovalQueueDepth(snapshot),
      this.collectAuditWriteFailureRate(snapshot),
      this.collectLlmFallbackRate(snapshot),
      this.collectMcpTimeoutRate(snapshot),
      this.collectSnapshotMaterializationLatency(snapshot),
      this.collectQueryBudgetViolations(snapshot),
      this.collectParserFailureRate(snapshot),
      this.collectWatermarkStaleness(snapshot),
    ]);

    return snapshot;
  }

  // ─── Individual metric collectors ────────────────────────────────────────

  private async collectPolicyEvalLatency(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ avg_val: string }>(
        `SELECT AVG(value)::NUMERIC(10,2) as avg_val
         FROM governance_operational_metrics
         WHERE metric_name = 'governance.policy_eval.duration_ms'
           AND recorded_at > NOW() - INTERVAL '${this.windowMinutes} minutes'`,
      );

      const avg = parseFloat(result.rows[0]?.avg_val ?? '0');
      if (!isNaN(avg) && avg > 0) {
        snap.policyEvalLatencyMs = avg;
        await recordMetric('governance.policy_eval_latency.p50_ms', avg, 'ms', { window: '5m' });
      }
    } catch (e) {
      snap.errors.push(`policy_eval_latency: ${(e as Error).message}`);
    }
  }

  private async collectApprovalQueueDepth(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM governance_approval_requests
         WHERE state = 'pending'`,
      ).catch(() => ({ rows: [{ count: '0' }] }));

      const depth = parseInt(result.rows[0]?.count ?? '0', 10);
      snap.approvalQueueDepth = depth;
      await recordMetric('governance.approval_queue_depth', depth, 'count', { window: '5m' });
    } catch (e) {
      snap.errors.push(`approval_queue_depth: ${(e as Error).message}`);
    }
  }

  private async collectAuditWriteFailureRate(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      // Count success vs failure metrics in last 5 minutes
      const result = await dbQuery<{ metric_name: string; count: string }>(
        `SELECT metric_name, COUNT(*) as count
         FROM governance_operational_metrics
         WHERE metric_name IN ('governance.audit_write.success', 'governance.audit_write.failure')
           AND recorded_at > NOW() - INTERVAL '${this.windowMinutes} minutes'
         GROUP BY metric_name`,
      );

      const byName: Record<string, number> = {};
      for (const row of result.rows) {
        byName[row.metric_name] = parseInt(row.count, 10);
      }

      const successes = byName['governance.audit_write.success'] ?? 0;
      const failures  = byName['governance.audit_write.failure']  ?? 0;
      const total     = successes + failures;

      if (total > 0) {
        const failRate = (failures / total) * 100;
        snap.auditWriteFailureRatePct = failRate;
        await recordMetric('governance.audit_write_failure_rate_pct', failRate, 'percent', { window: '5m' });

        // SLO: alert if audit write failure rate > 1%
        if (failRate > 1) {
          await recordSloViolation({
            sloId:           'slo-audit-write-failure',
            metricName:      'audit_write_failure_rate_pct',
            observedValue:   failRate,
            thresholdValue:  1,
            enforcementMode: 'ALERT',
            context:         { successes, failures, window: `${this.windowMinutes}m` },
          });
        }
      }
    } catch (e) {
      snap.errors.push(`audit_write_failure_rate: ${(e as Error).message}`);
    }
  }

  private async collectLlmFallbackRate(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ total: string; fallbacks: string }>(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN (tags->>'fallback')::boolean THEN 1 ELSE 0 END) as fallbacks
         FROM governance_operational_metrics
         WHERE metric_name = 'llm.inference.duration_ms'
           AND recorded_at > NOW() - INTERVAL '${this.windowMinutes} minutes'`,
      );

      const total     = parseInt(result.rows[0]?.total    ?? '0', 10);
      const fallbacks = parseInt(result.rows[0]?.fallbacks ?? '0', 10);

      if (total > 0) {
        const rate = (fallbacks / total) * 100;
        snap.llmFallbackRatePct = rate;
        await recordMetric('llm.fallback_rate_pct', rate, 'percent', { window: '5m' });
      }
    } catch (e) {
      snap.errors.push(`llm_fallback_rate: ${(e as Error).message}`);
    }
  }

  private async collectMcpTimeoutRate(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ total: string; timeouts: string }>(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN (tags->>'circuit_state') IN ('TIMEOUT', 'UNAVAILABLE') THEN 1 ELSE 0 END) as timeouts
         FROM governance_operational_metrics
         WHERE metric_name = 'splunk.mcp.duration_ms'
           AND recorded_at > NOW() - INTERVAL '${this.windowMinutes} minutes'`,
      );

      const total    = parseInt(result.rows[0]?.total    ?? '0', 10);
      const timeouts = parseInt(result.rows[0]?.timeouts ?? '0', 10);

      if (total > 0) {
        const rate = (timeouts / total) * 100;
        snap.mcpTimeoutRatePct = rate;
        await recordMetric('splunk.mcp_timeout_rate_pct', rate, 'percent', { window: '5m' });
      }
    } catch (e) {
      snap.errors.push(`mcp_timeout_rate: ${(e as Error).message}`);
    }
  }

  private async collectSnapshotMaterializationLatency(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ avg_val: string }>(
        `SELECT AVG(value)::NUMERIC(10,2) as avg_val
         FROM governance_operational_metrics
         WHERE metric_name = 'platform.gold_scoring.duration_ms'
           AND recorded_at > NOW() - INTERVAL '${this.windowMinutes} minutes'`,
      );

      const avg = parseFloat(result.rows[0]?.avg_val ?? '0');
      if (!isNaN(avg) && avg > 0) {
        snap.snapshotMaterializationMs = avg;
        await recordMetric('platform.snapshot_materialization_latency_ms', avg, 'ms', { window: '5m' });

        // SLO: warn if pipeline latency > 30 minutes (1800000 ms)
        const latencyMinutes = avg / 60_000;
        if (latencyMinutes > 30) {
          await recordSloViolation({
            sloId:           'slo-pipeline-latency',
            metricName:      'pipeline_latency_minutes',
            observedValue:   latencyMinutes,
            thresholdValue:  30,
            enforcementMode: 'WARN',
            context:         { avg_ms: avg },
          });
        }
      }
    } catch (e) {
      snap.errors.push(`snapshot_materialization_latency: ${(e as Error).message}`);
    }
  }

  private async collectQueryBudgetViolations(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM governance_operational_metrics
         WHERE metric_name = 'splunk.budget.violation_count'
           AND recorded_at > NOW() - INTERVAL '${this.windowMinutes} minutes'`,
      );

      const count = parseInt(result.rows[0]?.count ?? '0', 10);
      snap.queryBudgetViolations = count;
      await recordMetric('splunk.query_budget_violations', count, 'count', { window: '5m' });
    } catch (e) {
      snap.errors.push(`query_budget_violations: ${(e as Error).message}`);
    }
  }

  private async collectParserFailureRate(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ total: string; low_confidence: string }>(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN confidence_score < 0.5 THEN 1 ELSE 0 END) as low_confidence
         FROM parser_confidence_audit
         WHERE created_at > NOW() - INTERVAL '${this.windowMinutes} minutes'`,
      ).catch(() => ({ rows: [{ total: '0', low_confidence: '0' }] }));

      const total         = parseInt(result.rows[0]?.total          ?? '0', 10);
      const lowConfidence = parseInt(result.rows[0]?.low_confidence ?? '0', 10);

      if (total > 0) {
        const rate = (lowConfidence / total) * 100;
        snap.parserFailureRatePct = rate;
        await recordMetric('platform.parser_failure_rate_pct', rate, 'percent', { window: '5m' });

        // SLO: warn if parser confidence too low
        if (rate > 20) {
          await recordSloViolation({
            sloId:           'slo-unresolved-spl',
            metricName:      'unresolved_spl_pct',
            observedValue:   rate,
            thresholdValue:  20,
            enforcementMode: 'WARN',
            context:         { total_audited: total, low_confidence: lowConfidence },
          });
        }
      }
    } catch (e) {
      snap.errors.push(`parser_failure_rate: ${(e as Error).message}`);
    }
  }

  private async collectWatermarkStaleness(snap: SelfObservabilitySnapshot): Promise<void> {
    try {
      // db via static import
      

      const result = await dbQuery<{ hours_since: string }>(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(last_processed_at)))/3600 as hours_since
         FROM pipeline_watermarks`,
      ).catch(() => ({ rows: [{ hours_since: null }] }));

      const hoursSince = parseFloat(result.rows[0]?.hours_since ?? 'NaN');
      if (!isNaN(hoursSince)) {
        snap.watermarkStalenessHours = hoursSince;
        await recordMetric('platform.watermark_staleness_hours', hoursSince, 'hours', { window: '5m' });

        // SLO: alert if snapshots are older than 48h
        if (hoursSince > 48) {
          await recordSloViolation({
            sloId:           'slo-snapshot-freshness',
            metricName:      'snapshot_freshness_hours',
            observedValue:   hoursSince,
            thresholdValue:  48,
            enforcementMode: 'ALERT',
            context:         { hours_since_last_watermark: hoursSince },
          });
        }
      }
    } catch (e) {
      snap.errors.push(`watermark_staleness: ${(e as Error).message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instance for the worker process
// ─────────────────────────────────────────────────────────────────────────────

let _sharedCollector: GovernanceSelfObservabilityCollector | null = null;

export function getSharedCollector(): GovernanceSelfObservabilityCollector {
  if (!_sharedCollector) {
    _sharedCollector = new GovernanceSelfObservabilityCollector();
  }
  return _sharedCollector;
}

/**
 * Start the shared collector (called from worker entrypoint).
 * Idempotent — safe to call multiple times.
 */
export function startSelfObservability(intervalMs = 5 * 60_000): void {
  getSharedCollector().start(intervalMs);
  console.log(`[SelfObservability] Started — collecting every ${intervalMs / 1000}s`);
}

/**
 * Stop the shared collector (called on graceful shutdown).
 */
export function stopSelfObservability(): void {
  _sharedCollector?.stop();
  console.log('[SelfObservability] Stopped');
}
