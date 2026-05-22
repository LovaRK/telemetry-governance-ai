import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { getExplainabilityForTenant } from '@api/services/kpi-explainability-service';

const TOTAL_KPIS = 10;

export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;

  const records = await getExplainabilityForTenant(tenantId);

  const expandable = records.filter((r) => r.formulaExpression && r.formulaExpression !== 'Unavailable').length;
  const missingProvenance = Math.max(0, TOTAL_KPIS - records.filter((r) => r.sourceTable && r.sourceTable !== 'Unknown').length);
  const missingConfidence = Math.max(0, TOTAL_KPIS - records.filter((r) => ['HIGH', 'MEDIUM', 'LOW'].includes(String(r.confidence))).length);
  const missingFormulas = Math.max(0, TOTAL_KPIS - records.filter((r) => r.formulaExpression && r.formulaExpression !== 'Unavailable').length);

  const coveragePercent = Number(((expandable / TOTAL_KPIS) * 100).toFixed(2));

  return {
    data: {
      totalKpis: TOTAL_KPIS,
      expandableKpis: expandable,
      coveragePercent,
      missingProvenance,
      missingConfidence,
      missingFormulas,
    },
    meta: { source: 'postgres', tenantId },
  };
});
