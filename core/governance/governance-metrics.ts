/**
 * Governance Metrics
 * Infrastructure telemetry for the governance layer.
 * Tracks decision volume, failures, mismatches, and latency.
 *
 * These metrics are CRITICAL once governance becomes authoritative.
 * Operations must observe the governance engine like any other production infrastructure.
 */

interface MetricTags {
  environment?: 'sandbox' | 'production';
  decision?: string; // ALLOW, DENY, etc.
  rge_decision?: string;
  old_validator_decision?: string;
  risk_level?: string; // LOW, MODERATE, HIGH, CRITICAL
  action?: string; // SAVE_SPLUNK_CONFIG, etc.
  mode?: string; // SHADOW, ENFORCING
  reason?: string;
  mismatch_type?: string;
}

/**
 * In-memory metrics store (simple counter implementation).
 * In production, integrate with Prometheus, CloudWatch, Datadog, etc.
 */
class GovernanceMetrics {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  /**
   * Increment a counter with optional tags.
   * Example: increment('governance_decisions_total', { decision: 'ALLOW' })
   */
  increment(name: string, tags?: MetricTags): void {
    const key = this.buildKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + 1);
  }

  /**
   * Record a latency measurement (milliseconds).
   * Example: recordLatency('governance_evaluation_ms', 4.5, { decision: 'ALLOW' })
   */
  recordLatency(name: string, ms: number, tags?: MetricTags): void {
    const key = this.buildKey(name, tags);
    const values = this.histograms.get(key) || [];
    values.push(ms);
    this.histograms.set(key, values);
  }

  /**
   * Get counter value by name and tags.
   */
  getCounter(name: string, tags?: MetricTags): number {
    const key = this.buildKey(name, tags);
    return this.counters.get(key) || 0;
  }

  /**
   * Get latency percentiles (p50, p95, p99).
   */
  getLatencyPercentiles(name: string, tags?: MetricTags): { p50: number; p95: number; p99: number } {
    const key = this.buildKey(name, tags);
    const values = this.histograms.get(key) || [];
    if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };

    const sorted = values.sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  /**
   * Export all metrics for logging/monitoring.
   */
  export(): Record<string, any> {
    const counterExport: Record<string, number> = {};
    const histogramExport: Record<string, any> = {};

    for (const [key, value] of this.counters) {
      counterExport[key] = value;
    }

    for (const [key] of this.histograms) {
      histogramExport[key] = this.getLatencyPercentiles(
        key.split('|')[0],
        this.parseTagsFromKey(key)
      );
    }

    return {
      counters: counterExport,
      latencies: histogramExport,
      timestamp: new Date().toISOString()
    };
  }

  private buildKey(name: string, tags?: MetricTags): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name;
    }
    const tagStr = Object.entries(tags)
      .filter(([, v]) => v !== undefined)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}|${tagStr}`;
  }

  private parseTagsFromKey(key: string): MetricTags {
    const [, tagStr] = key.split('|');
    if (!tagStr) return {};
    const tags: MetricTags = {};
    tagStr.split(',').forEach(pair => {
      const [k, v] = pair.split('=');
      (tags as Record<string, any>)[k] = v;
    });
    return tags;
  }
}

// Global metrics instance
export const metrics = new GovernanceMetrics();

/**
 * Record a governance decision.
 * CRITICAL: Call this after every evaluate() call.
 */
export function recordGovernanceDecision(
  decision: string,
  riskLevel: string,
  action: string,
  environment: 'sandbox' | 'production',
  evaluationMs: number
): void {
  // Total decisions
  metrics.increment('governance_decisions_total', {
    decision,
    risk_level: riskLevel,
    action,
    environment
  });

  // Denials
  if (decision === 'DENY' || decision === 'REQUIRE_APPROVAL') {
    metrics.increment('governance_denials_total', {
      decision,
      action,
      environment
    });
  }

  // Evaluation latency
  metrics.recordLatency('governance_evaluation_ms', evaluationMs, {
    decision,
    environment
  });
}

/**
 * Record a shadow mode mismatch.
 * CRITICAL: Call this when RGE decision differs from old validator.
 */
export function recordShadowModeMismatch(
  rgeDecision: string,
  oldValidatorDecision: string,
  environment: 'sandbox' | 'production'
): void {
  metrics.increment('governance_shadow_mismatches_total', {
    rge_decision: rgeDecision,
    old_validator_decision: oldValidatorDecision,
    environment
  });
}

/**
 * Record a governance evaluation failure.
 * CRITICAL: Call this when evaluate() throws.
 */
export function recordGovernanceEvaluationFailure(
  reason: string,
  environment: 'sandbox' | 'production'
): void {
  metrics.increment('governance_evaluation_failures_total', {
    reason,
    environment
  });
}

/**
 * Record a policy evaluation.
 * Used to track policy execution frequency.
 */
export function recordPolicyEvaluation(
  policyId: string,
  evaluationMs: number,
  environment: 'sandbox' | 'production'
): void {
  metrics.recordLatency('governance_policy_evaluations_ms', evaluationMs, {
    action: policyId,
    environment
  });
}

/**
 * Log all metrics periodically.
 * Call this from startup or on-demand for monitoring.
 */
export function logGovernanceMetrics(): void {
  console.log('[GOVERNANCE_METRICS]', metrics.export());
}

/**
 * Get specific metric for monitoring/alerting.
 */
export function getGovernanceMetric(name: string, tags?: MetricTags): number {
  return metrics.getCounter(name, tags);
}

/**
 * Get latency percentiles for alert thresholds.
 */
export function getGovernanceLatencyPercentiles(
  name: string,
  tags?: MetricTags
): { p50: number; p95: number; p99: number } {
  return metrics.getLatencyPercentiles(name, tags);
}

/**
 * Mismatch classification (for drift reporting).
 * Not all mismatches are equally dangerous.
 */
export enum MismatchType {
  NORMALIZATION = 'normalization',      // Input parsed differently
  POLICY = 'policy',                    // Policy evaluation differs
  ENVIRONMENT = 'environment',          // Environment detection differs
  REASONING = 'reasoning',              // Decision logic differs
  ENFORCEMENT = 'enforcement'           // Same decision, different mode
}

/**
 * Record a classified mismatch.
 * Enables drift reporting with mismatch type breakdown.
 */
export function recordClassifiedMismatch(
  type: MismatchType,
  rgeDecision: string,
  oldValidatorDecision: string,
  environment: 'sandbox' | 'production'
): void {
  metrics.increment('governance_classified_mismatches_total', {
    mismatch_type: type,
    rge_decision: rgeDecision,
    old_validator_decision: oldValidatorDecision,
    environment
  });

  // Also increment total for shadow_consensus_rate calculation
  metrics.increment('governance_shadow_comparisons_total', { environment });
}

/**
 * Record a matching decision (for consensus rate).
 */
export function recordShadowConsensusMatch(
  environment: 'sandbox' | 'production'
): void {
  metrics.increment('governance_shadow_matches_total', { environment });
  metrics.increment('governance_shadow_comparisons_total', { environment });
}

/**
 * Calculate shadow consensus rate: matching / total.
 * Target: 100% (0 mismatches).
 */
export function getShadowConsensusRate(environment?: 'sandbox' | 'production'): number {
  const tags = environment ? { environment } : undefined;
  const matches = metrics.getCounter('governance_shadow_matches_total', tags);
  const comparisons = metrics.getCounter('governance_shadow_comparisons_total', tags);

  if (comparisons === 0) return 100; // No comparisons yet
  return (matches / comparisons) * 100;
}

/**
 * Governance drift report for monitoring window.
 * Generated hourly or on-demand.
 * Critical for operator confidence before cutover.
 */
export interface GovernanceDriftReport {
  window: string; // "1h", "24h", etc.
  timestamp: string;
  summary: {
    total_evaluations: number;
    mismatches: number;
    evaluation_failures: number;
    shadow_consensus_rate: number;
    avg_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
  };
  by_action: Array<{
    action: string;
    evaluations: number;
    mismatches: number;
    failures: number;
  }>;
  mismatch_types: Array<{
    type: string;
    count: number;
    examples: Array<{
      rge_decision: string;
      old_validator_decision: string;
      environment: string;
    }>;
  }>;
  normalization_edge_cases: Array<{
    normalized_resource: string;
    variants_seen: number;
    input_fingerprint: string;
  }>;
}

/**
 * Generate governance drift report.
 * Call this hourly during monitoring phase.
 */
export function generateGovernanceDriftReport(window: string = '1h'): GovernanceDriftReport {
  const allMetrics = metrics.export();
  const totalEvals = metrics.getCounter('governance_decisions_total');
  const mismatches = metrics.getCounter('governance_shadow_mismatches_total');
  const failures = metrics.getCounter('governance_evaluation_failures_total');
  const latencies = metrics.getLatencyPercentiles('governance_evaluation_ms');

  return {
    window,
    timestamp: new Date().toISOString(),
    summary: {
      total_evaluations: totalEvals,
      mismatches,
      evaluation_failures: failures,
      shadow_consensus_rate: getShadowConsensusRate(),
      avg_latency_ms: latencies.p50,
      p95_latency_ms: latencies.p95,
      p99_latency_ms: latencies.p99
    },
    by_action: [
      // TODO: Aggregate by action from counters
    ],
    mismatch_types: [
      // TODO: Breakdown by MismatchType
    ],
    normalization_edge_cases: [
      // TODO: Track normalization variants
    ]
  };
}

/**
 * Log drift report for operator review.
 */
export function logGovernanceDriftReport(window?: string): void {
  const report = generateGovernanceDriftReport(window);
  console.log('[GOVERNANCE_DRIFT_REPORT]', report);
}
