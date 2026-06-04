import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import { NextResponse } from 'next/server';

/**
 * GET /api/governance/certifications
 * Returns certification history for the tenant — used for operational audit of
 * which snapshots passed/failed validation before being published.
 */
export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '20', 10), 100);

  const result = await query<any>(
    `SELECT certification_id, snapshot_id, snapshot_source, validated_at,
       validated_by, rule_count, passed_checks, failed_checks, certified,
       failure_reasons
     FROM snapshot_certifications
     WHERE tenant_id::text = $1
     ORDER BY validated_at DESC LIMIT $2`,
    [tenantId, limit]
  );

  const certCount   = result.rows.filter((r: any) => r.certified).length;
  const failCount   = result.rows.filter((r: any) => !r.certified).length;

  return {
    data: {
      overview: { total: result.rows.length, certified: certCount, failed: failCount },
      certifications: result.rows.map((r: any) => ({
        certificationId:  r.certification_id,
        snapshotId:       r.snapshot_id,
        snapshotSource:   r.snapshot_source,
        validatedAt:      r.validated_at,
        validatedBy:      r.validated_by,
        ruleCount:        r.rule_count,
        passedChecks:     r.passed_checks,
        failedChecks:     r.failed_checks,
        certified:        r.certified,
        failureReasons:   r.failure_reasons,
      })),
    },
    meta: { tenantId },
  };
});
