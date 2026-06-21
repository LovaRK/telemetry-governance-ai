import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import { NextResponse } from 'next/server';

/**
 * GET /api/governance/certifications
 *
 * Returns certification history with per-rule breakdown.
 * When a certification fails, every rule result is available for diagnosis:
 *   Which rule? What values triggered it? When did it execute?
 *
 * Query params:
 *   limit       — max certifications returned (default 20, max 100)
 *   snapshot_id — filter to a specific snapshot
 *   failed_only — 'true' to return only failed certifications
 */
export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;

  const params  = new URL(request.url).searchParams;
  const limit       = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const snapshotId  = params.get('snapshot_id') || null;
  const failedOnly  = params.get('failed_only') === 'true';

  // Summary rows
  const conditions: string[] = [`c.tenant_id::text = $1`];
  const args: unknown[]      = [tenantId];
  if (snapshotId)  { args.push(snapshotId); conditions.push(`c.snapshot_id::text = $${args.length}`); }
  if (failedOnly)  { conditions.push(`c.certified = false`); }
  args.push(limit);

  const summaryResult = await query<any>(
    `SELECT c.certification_id, c.snapshot_id, c.snapshot_source,
            c.validated_at, c.validated_by,
            c.rule_count, c.passed_checks, c.failed_checks,
            c.certified, c.failure_reasons
     FROM snapshot_certifications c
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.validated_at DESC
     LIMIT $${args.length}`,
    args
  );

  // Per-rule detail for each certification
  const certIds = summaryResult.rows.map((r: any) => r.certification_id);
  let ruleRows: any[] = [];
  if (certIds.length > 0) {
    const ruleResult = await query<any>(
      `SELECT certification_id, rule_name, rule_description, passed, details, executed_at
       FROM snapshot_certification_rules
       WHERE certification_id = ANY($1::uuid[])
       ORDER BY certification_id, rule_name`,
      [certIds]
    );
    ruleRows = ruleResult.rows;
  }

  // Group per-rule rows by certification_id
  const rulesBycert: Record<string, any[]> = {};
  for (const row of ruleRows) {
    const cid = row.certification_id;
    if (!rulesBycert[cid]) rulesBycert[cid] = [];
    rulesBycert[cid].push({
      ruleName:        row.rule_name,
      description:     row.rule_description,
      passed:          row.passed,
      details:         row.details,
      executedAt:      row.executed_at,
    });
  }

  const certCount = summaryResult.rows.filter((r: any) =>  r.certified).length;
  const failCount = summaryResult.rows.filter((r: any) => !r.certified).length;

  return {
    data: {
      overview: { total: summaryResult.rows.length, certified: certCount, failed: failCount },
      certifications: summaryResult.rows.map((r: any) => ({
        certificationId: r.certification_id,
        snapshotId:      r.snapshot_id,
        snapshotSource:  r.snapshot_source,
        validatedAt:     r.validated_at,
        validatedBy:     r.validated_by,
        ruleCount:       r.rule_count,
        passedChecks:    r.passed_checks,
        failedChecks:    r.failed_checks,
        certified:       r.certified,
        failureReasons:  r.failure_reasons,
        // Per-rule breakdown — null when rules not yet recorded (older certifications)
        rules:           rulesBycert[r.certification_id] ?? null,
      })),
    },
    meta: { tenantId },
  };
});
