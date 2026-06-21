/**
 * Query Budget Service
 *
 * Enforces per-tenant query cost limits.
 * Tracking cost is not enough — budgets must be enforced.
 *
 * Enforcement modes:
 *   WARN             — log warning, allow query
 *   THROTTLE         — add forced delay before allowing query
 *   REQUIRE_APPROVAL — block query, emit governance approval request
 *   DENY             — hard block immediately
 *
 * Usage:
 * ```typescript
 * const budget = await queryBudgetService.checkBudget(tenantId, estimatedScanGb);
 * if (budget.action === 'DENY') {
 *   throw new QueryBudgetExceeded(tenantId, budget.reason);
 * }
 * if (budget.action === 'THROTTLE') {
 *   await sleep(budget.throttle_delay_ms!);
 * }
 * // ... proceed with query
 * await queryBudgetService.recordUsage(tenantId, { scan_gb: actualScanGb });
 * ```
 */

import { query } from '../../../core/database/connection';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type BudgetEnforcementMode = 'WARN' | 'THROTTLE' | 'REQUIRE_APPROVAL' | 'DENY';

export interface QueryBudgetLimits {
  tenant_id: string;
  daily_scan_gb: number;
  max_runtime_ms: number;
  max_concurrent_jobs: number;
  enforcement_mode: BudgetEnforcementMode;
}

export interface QueryDailyUsage {
  tenant_id: string;
  usage_date: string;
  total_scan_gb: number;
  total_jobs: number;
  denied_jobs: number;
  throttled_jobs: number;
}

export type BudgetAction = 'ALLOW' | 'WARN' | 'THROTTLE' | 'REQUIRE_APPROVAL' | 'DENY';

export interface BudgetCheckResult {
  action: BudgetAction;
  reason: string;
  current_scan_gb: number;
  limit_scan_gb: number;
  utilization_pct: number;
  throttle_delay_ms?: number;   // set when action=THROTTLE
}

export class QueryBudgetExceeded extends Error {
  public readonly tenantId: string;
  public readonly reason: string;
  public readonly enforcement_mode: BudgetEnforcementMode;

  constructor(tenantId: string, reason: string, mode: BudgetEnforcementMode) {
    super(`[QUERY_BUDGET_EXCEEDED] tenant=${tenantId}: ${reason}`);
    this.name = 'QueryBudgetExceeded';
    this.tenantId = tenantId;
    this.reason = reason;
    this.enforcement_mode = mode;
  }
}

// ─────────────────────────────────────────────
// Fallback limits
// ─────────────────────────────────────────────

const DEFAULT_LIMITS: QueryBudgetLimits = {
  tenant_id: 'SYSTEM',
  daily_scan_gb: 100,
  max_runtime_ms: 30000,
  max_concurrent_jobs: 5,
  enforcement_mode: 'WARN'
};

// ─────────────────────────────────────────────
// Budget Service
// ─────────────────────────────────────────────

class QueryBudgetService {

  /**
   * Get budget limits for a tenant.
   * Falls back to SYSTEM limits, then to hardcoded defaults.
   */
  async getLimits(tenantId: string): Promise<QueryBudgetLimits> {
    try {
      const result = await query<QueryBudgetLimits>(
        `SELECT tenant_id, daily_scan_gb, max_runtime_ms, max_concurrent_jobs, enforcement_mode
         FROM query_budget_limits
         WHERE tenant_id = $1 OR tenant_id = 'SYSTEM'
         ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [tenantId]
      );
      return result.rows[0] ?? DEFAULT_LIMITS;
    } catch {
      return DEFAULT_LIMITS;
    }
  }

  /**
   * Get today's usage for a tenant.
   */
  async getDailyUsage(tenantId: string): Promise<QueryDailyUsage> {
    try {
      const result = await query<QueryDailyUsage>(
        `SELECT tenant_id, usage_date::TEXT, total_scan_gb, total_jobs, denied_jobs, throttled_jobs
         FROM query_daily_usage
         WHERE tenant_id = $1 AND usage_date = CURRENT_DATE`,
        [tenantId]
      );
      return result.rows[0] ?? {
        tenant_id: tenantId,
        usage_date: new Date().toISOString().slice(0, 10),
        total_scan_gb: 0,
        total_jobs: 0,
        denied_jobs: 0,
        throttled_jobs: 0
      };
    } catch {
      return {
        tenant_id: tenantId,
        usage_date: new Date().toISOString().slice(0, 10),
        total_scan_gb: 0,
        total_jobs: 0,
        denied_jobs: 0,
        throttled_jobs: 0
      };
    }
  }

  /**
   * Check if a query is within budget.
   * Call BEFORE submitting a query to Splunk.
   *
   * @param tenantId       - Tenant making the query
   * @param estimatedScanGb - Estimated scan volume in GB (0 if unknown)
   */
  async checkBudget(
    tenantId: string,
    estimatedScanGb: number = 0
  ): Promise<BudgetCheckResult> {
    const [limits, usage] = await Promise.all([
      this.getLimits(tenantId),
      this.getDailyUsage(tenantId)
    ]);

    const projectedScanGb = usage.total_scan_gb + estimatedScanGb;
    const utilizationPct = (projectedScanGb / limits.daily_scan_gb) * 100;

    const logPayload = {
      tenant_id: tenantId,
      current_scan_gb: usage.total_scan_gb,
      estimated_scan_gb: estimatedScanGb,
      projected_scan_gb: projectedScanGb,
      limit_scan_gb: limits.daily_scan_gb,
      utilization_pct: Math.round(utilizationPct),
      enforcement_mode: limits.enforcement_mode,
      timestamp: new Date().toISOString()
    };

    // Already exceeded limit
    if (projectedScanGb > limits.daily_scan_gb) {
      const reason = `Daily scan limit exceeded: ${projectedScanGb.toFixed(2)}GB > ${limits.daily_scan_gb}GB`;

      switch (limits.enforcement_mode) {
        case 'DENY':
          console.error('[QUERY_BUDGET_DENIED]', { ...logPayload, reason });
          return {
            action: 'DENY',
            reason,
            current_scan_gb: usage.total_scan_gb,
            limit_scan_gb: limits.daily_scan_gb,
            utilization_pct: utilizationPct
          };

        case 'REQUIRE_APPROVAL':
          console.warn('[QUERY_BUDGET_APPROVAL_REQUIRED]', { ...logPayload, reason });
          return {
            action: 'REQUIRE_APPROVAL',
            reason,
            current_scan_gb: usage.total_scan_gb,
            limit_scan_gb: limits.daily_scan_gb,
            utilization_pct: utilizationPct
          };

        case 'THROTTLE': {
          const delay = Math.min(5000 * utilizationPct / 100, 30000); // up to 30s
          console.warn('[QUERY_BUDGET_THROTTLED]', { ...logPayload, reason, throttle_ms: delay });
          return {
            action: 'THROTTLE',
            reason,
            current_scan_gb: usage.total_scan_gb,
            limit_scan_gb: limits.daily_scan_gb,
            utilization_pct: utilizationPct,
            throttle_delay_ms: delay
          };
        }

        default: // WARN
          console.warn('[QUERY_BUDGET_WARN]', { ...logPayload, reason });
          return {
            action: 'WARN',
            reason,
            current_scan_gb: usage.total_scan_gb,
            limit_scan_gb: limits.daily_scan_gb,
            utilization_pct: utilizationPct
          };
      }
    }

    // Within budget
    return {
      action: 'ALLOW',
      reason: 'Within daily budget',
      current_scan_gb: usage.total_scan_gb,
      limit_scan_gb: limits.daily_scan_gb,
      utilization_pct: utilizationPct
    };
  }

  /**
   * Record actual query usage after completion.
   * Call AFTER a query completes (success or partial).
   */
  async recordUsage(
    tenantId: string,
    usage: {
      scan_gb?: number;
      denied?: boolean;
      throttled?: boolean;
    }
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO query_daily_usage
           (tenant_id, usage_date, total_scan_gb, total_jobs, denied_jobs, throttled_jobs, updated_at)
         VALUES ($1, CURRENT_DATE, $2, 1, $3, $4, NOW())
         ON CONFLICT (tenant_id, usage_date) DO UPDATE
           SET total_scan_gb  = query_daily_usage.total_scan_gb + EXCLUDED.total_scan_gb,
               total_jobs     = query_daily_usage.total_jobs + 1,
               denied_jobs    = query_daily_usage.denied_jobs + EXCLUDED.denied_jobs,
               throttled_jobs = query_daily_usage.throttled_jobs + EXCLUDED.throttled_jobs,
               updated_at     = NOW()`,
        [
          tenantId,
          usage.scan_gb ?? 0,
          usage.denied ? 1 : 0,
          usage.throttled ? 1 : 0
        ]
      );
    } catch (error) {
      // Non-critical: usage tracking failure doesn't block queries
      console.warn('[QUERY_BUDGET_RECORD_FAILED]', {
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get concurrent job count for a tenant.
   * Used to enforce max_concurrent_jobs limit.
   */
  async getConcurrentJobCount(tenantId: string): Promise<number> {
    try {
      const result = await query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM splunk_search_jobs
         WHERE tenant_id = $1 AND status IN ('pending', 'running')`,
        [tenantId]
      );
      return parseInt(result.rows[0]?.count ?? '0', 10);
    } catch {
      return 0;
    }
  }
}

export const queryBudgetService = new QueryBudgetService();
