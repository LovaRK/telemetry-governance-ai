/**
 * OPA Audit Health Endpoint
 *
 * Monitors OPA integration in audit mode:
 * - OPA reachability
 * - Policy evaluation volume
 * - Event emission integrity (trace context, source attribution)
 * - Decision distribution by profile
 *
 * Used to validate OPA audit-mode behavior before moving to enforce mode.
 */

import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

const OPA_URL = process.env.OPA_URL || 'http://localhost:8181';
const OPA_ENFORCEMENT_MODE = process.env.OPA_ENFORCEMENT_MODE || 'audit';

export const GET = createRoute(async (req: NextRequest) => {
  // 1. Check OPA reachability
  let opaReachable = false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${OPA_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    opaReachable = response.ok;
  } catch (err) {
    opaReachable = false;
  }

  // 2. Query policy evaluation volume (last 24h)
  const volumeResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM pipeline_events
     WHERE event_type = 'policy_evaluated'
       AND timestamp > NOW() - INTERVAL '24 hours'`
  );
  const policyEvaluationsLast24h = parseInt(
    volumeResult.rows[0]?.count || '0'
  );

  // 3. Check for untraced policy events (should be 0)
  const untracedResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM pipeline_events
     WHERE event_type = 'policy_evaluated'
       AND trace_id IS NULL`
  );
  const untracedPolicyEvents = parseInt(untracedResult.rows[0]?.count || '0');

  // 4. Check for non-live policy events (should be 0)
  const nonLiveResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM pipeline_events
     WHERE event_type = 'policy_evaluated'
       AND (mode IS NULL OR mode <> 'live')`
  );
  const nonLivePolicyEvents = parseInt(nonLiveResult.rows[0]?.count || '0');

  // 5. Check for unattributed policy events (should be 0)
  const unattributedResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM pipeline_events
     WHERE event_type = 'policy_evaluated'
       AND source IS NULL`
  );
  const unattributedPolicyEvents = parseInt(
    unattributedResult.rows[0]?.count || '0'
  );

  // 6. Count DENY decisions in audit mode (for risk assessment)
  const denyCountResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM pipeline_events
     WHERE event_type = 'policy_evaluated'
       AND (payload->>'decision')::text = 'DENY'
       AND timestamp > NOW() - INTERVAL '24 hours'`
  );
  const denyCountAuditMode = parseInt(denyCountResult.rows[0]?.count || '0');

  // 7. Get decision distribution
  const distributionResult = await query<{
    decision: string;
    count: string;
  }>(
    `SELECT (payload->>'decision')::text AS decision, COUNT(*)::text AS count
     FROM pipeline_events
     WHERE event_type = 'policy_evaluated'
       AND timestamp > NOW() - INTERVAL '24 hours'
     GROUP BY (payload->>'decision')::text
     ORDER BY count DESC`
  );

  const decisionDistribution: Record<string, number> = {};
  for (const row of distributionResult.rows || []) {
    decisionDistribution[row.decision] = parseInt(row.count);
  }

  // 8. Overall health
  const healthy =
    opaReachable &&
    untracedPolicyEvents === 0 &&
    nonLivePolicyEvents === 0 &&
    unattributedPolicyEvents === 0;

  return {
    data: {
      status: healthy ? 'PASS' : 'WARN',
      opaReachable,
      enforcementMode: OPA_ENFORCEMENT_MODE,
      policyEvaluationsLast24h,
      untracedPolicyEvents,
      nonLivePolicyEvents,
      unattributedPolicyEvents,
      denyCountAuditMode,
      decisionDistribution,
      evaluatedAt: new Date().toISOString(),
      readyForEnforceMode:
        healthy &&
        untracedPolicyEvents === 0 &&
        nonLivePolicyEvents === 0 &&
        unattributedPolicyEvents === 0 &&
        policyEvaluationsLast24h > 0,
    },
    meta: {
      source: 'postgres',
    },
  };
});
