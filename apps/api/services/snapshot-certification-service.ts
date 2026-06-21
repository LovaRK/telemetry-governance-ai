/**
 * Snapshot Certification Service
 *
 * Validates a snapshot before it becomes the active pointer.
 * Runs 8 deterministic rules against the scored data.
 * A snapshot must pass ALL rules to be certified.
 *
 * Call sequence (ingest pipeline):
 *   1. Score sourcetypes
 *   2. Write telemetry_snapshots + agent_decisions + governance_audit_events
 *   3. certifySnapshot()  ← this service
 *   4. If certified → update tenant_snapshot_pointer
 *   5. If not certified → log failure, do not publish
 *
 * Rules:
 *   R1  Minimum sourcetypes (> 0)
 *   R2  Every row has a valid tier
 *   R3  Action matches tier (no tier/action mismatches)
 *   R4  Savings formula: Wasteful=95%, NiceToHave=50%, else 0
 *   R5  No Critical/Important sourcetype has estimated_savings > 0
 *   R6  Quick-win flag consistency
 *   R7  Composite score in valid range [0, 100]
 *   R8  Audit record count matches decision count (lineage completeness)
 */

import { Pool } from 'pg';

export interface CertificationResult {
  certified:     boolean;
  rule_count:    number;
  passed_checks: number;
  failed_checks: number;
  failure_reasons: string[];
  snapshot_id:   string;
  tenant_id:     string;
}

export class SnapshotCertificationService {
  constructor(private pool: Pool) {}

  async certifySnapshot(
    snapshotId: string,
    tenantId: string,
    validatedBy = 'system'
  ): Promise<CertificationResult> {

    const failures: string[] = [];
    let ruleCount  = 0;
    let passCount  = 0;

    // ── R1: Minimum sourcetypes ───────────────────────────────────────────────
    ruleCount++;
    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT sourcetype)::text AS count
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2`,
      [tenantId, snapshotId]
    );
    const sourcetypeCount = parseInt(countRes.rows[0]?.count || '0', 10);
    if (sourcetypeCount < 1) {
      failures.push(`R1: No sourcetypes found (count=${sourcetypeCount})`);
    } else {
      passCount++;
    }

    // ── R2: All tiers are valid values ────────────────────────────────────────
    ruleCount++;
    const validTiers = ['Critical', 'Important', 'Nice-to-Have', 'Wasteful'];
    const invalidTierRes = await this.pool.query<{ tier: string; count: string }>(
      `SELECT tier, COUNT(*)::text AS count
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2
         AND tier NOT IN ('Critical','Important','Nice-to-Have','Wasteful')
       GROUP BY tier`,
      [tenantId, snapshotId]
    );
    if (invalidTierRes.rows.length > 0) {
      const bad = invalidTierRes.rows.map(r => `${r.tier}(×${r.count})`).join(', ');
      failures.push(`R2: Invalid tier values: ${bad}`);
    } else {
      passCount++;
    }

    // ── R3: Action matches tier ───────────────────────────────────────────────
    ruleCount++;
    const actionMismatchRes = await this.pool.query<{ sourcetype: string; tier: string; action: string }>(
      `SELECT sourcetype, tier, action
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2
         AND (
           (tier IN ('Critical','Important') AND action != 'KEEP')
           OR (tier = 'Nice-to-Have' AND action != 'OPTIMIZE')
           OR (tier = 'Wasteful' AND action != 'ELIMINATE')
         )
       LIMIT 5`,
      [tenantId, snapshotId]
    );
    if (actionMismatchRes.rows.length > 0) {
      const bad = actionMismatchRes.rows.map(r => `${r.sourcetype}(${r.tier}→${r.action})`).join(', ');
      failures.push(`R3: Action/tier mismatches: ${bad}`);
    } else {
      passCount++;
    }

    // ── R4: Savings formula (Wasteful=95%, NiceToHave=50%, else 0) ───────────
    ruleCount++;
    const savingsViolRes = await this.pool.query<{ sourcetype: string; tier: string; cost: string; savings: string }>(
      `SELECT sourcetype, tier,
              annual_license_cost::text AS cost,
              estimated_savings::text AS savings
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2
         AND NOT (
           (tier = 'Wasteful'     AND ABS(estimated_savings - annual_license_cost * 0.95) < 1.0)
           OR (tier = 'Nice-to-Have' AND ABS(estimated_savings - annual_license_cost * 0.50) < 1.0)
           OR (tier IN ('Critical','Important') AND estimated_savings = 0)
         )
       LIMIT 5`,
      [tenantId, snapshotId]
    );
    if (savingsViolRes.rows.length > 0) {
      const bad = savingsViolRes.rows.map(r => `${r.sourcetype}(${r.tier}:cost=${r.cost},sav=${r.savings})`).join(', ');
      failures.push(`R4: Savings formula violations: ${bad}`);
    } else {
      passCount++;
    }

    // ── R5: Critical/Important never have estimated_savings > 0 ──────────────
    ruleCount++;
    const protectedSavingsRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2
         AND tier IN ('Critical','Important')
         AND estimated_savings > 0.01`,
      [tenantId, snapshotId]
    );
    if (parseInt(protectedSavingsRes.rows[0]?.count || '0', 10) > 0) {
      failures.push(`R5: ${protectedSavingsRes.rows[0].count} Critical/Important rows have savings > 0`);
    } else {
      passCount++;
    }

    // ── R6: Quick-win flag consistency ────────────────────────────────────────
    ruleCount++;
    const qwViolRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2
         AND (
           (is_quick_win = true AND tier NOT IN ('Nice-to-Have','Wasteful'))
           OR (is_quick_win = true AND tier IN ('Nice-to-Have','Wasteful') AND annual_license_cost <= 500)
           OR (is_quick_win = false AND tier IN ('Nice-to-Have','Wasteful') AND annual_license_cost > 500)
         )`,
      [tenantId, snapshotId]
    );
    if (parseInt(qwViolRes.rows[0]?.count || '0', 10) > 0) {
      failures.push(`R6: ${qwViolRes.rows[0].count} quick-win flag violations`);
    } else {
      passCount++;
    }

    // ── R7: Composite scores in valid range [0, 100] ──────────────────────────
    ruleCount++;
    const rangeRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM agent_decisions
       WHERE tenant_id = $1 AND snapshot_id = $2
         AND (composite_score < 0 OR composite_score > 100)`,
      [tenantId, snapshotId]
    );
    if (parseInt(rangeRes.rows[0]?.count || '0', 10) > 0) {
      failures.push(`R8: ${rangeRes.rows[0].count} composite scores outside [0,100]`);
    } else {
      passCount++;
    }

    // ── R8: Audit record count matches decision count ─────────────────────────
    ruleCount++;
    const auditCountRes = await this.pool.query<{ decisions: string; audits: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM agent_decisions
          WHERE tenant_id = $1 AND snapshot_id = $2) AS decisions,
         (SELECT COUNT(*)::text FROM governance_audit_events
          WHERE tenant_id = $1 AND snapshot_id = $2) AS audits`,
      [tenantId, snapshotId]
    );
    const decisionCount = parseInt(auditCountRes.rows[0]?.decisions || '0', 10);
    const auditCount    = parseInt(auditCountRes.rows[0]?.audits    || '0', 10);
    if (decisionCount !== auditCount) {
      failures.push(`R8: Decision count (${decisionCount}) ≠ audit event count (${auditCount}) — lineage incomplete`);
    } else {
      passCount++;
    }

    const certified = failures.length === 0;

    // Persist certification result
    await this.pool.query(
      `INSERT INTO snapshot_certifications
         (tenant_id, snapshot_id, snapshot_source, validated_by,
          rule_count, passed_checks, failed_checks, certified, failure_reasons)
       VALUES ($1,$2,'csv_analytics',$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING`,
      [
        tenantId, snapshotId, validatedBy,
        ruleCount, passCount, failures.length,
        certified,
        failures.length > 0 ? JSON.stringify(failures) : null,
      ]
    );

    return {
      certified,
      rule_count:      ruleCount,
      passed_checks:   passCount,
      failed_checks:   failures.length,
      failure_reasons: failures,
      snapshot_id:     snapshotId,
      tenant_id:       tenantId,
    };
  }
}
