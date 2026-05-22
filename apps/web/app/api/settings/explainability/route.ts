import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { requireContext } from '@packages/auth/request-context';
import { query } from '@core/database/connection';

export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;

  const row = await query<any>(
    `SELECT explainability_mode
     FROM user_config
     WHERE tenant_id = $1 AND user_id = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [ctxOrError.tenantId, ctxOrError.userId],
    ctxOrError
  );

  return {
    data: { explainabilityMode: Boolean(row.rows[0]?.explainability_mode ?? false) },
    meta: { source: 'postgres', tenantId: ctxOrError.tenantId },
  };
});

export const POST = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;

  const body = await request.json().catch(() => ({}));
  const mode = Boolean(body?.explainabilityMode);

  await query(
    `INSERT INTO user_config (config_key, tenant_id, user_id, explainability_mode, updated_at)
     VALUES ('default', $1, $2, $3, NOW())
     ON CONFLICT (tenant_id, config_key)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       explainability_mode = EXCLUDED.explainability_mode,
       updated_at = NOW()`,
    [ctxOrError.tenantId, ctxOrError.userId, mode],
    ctxOrError
  );

  return {
    data: { ok: true, explainabilityMode: mode },
    meta: { source: 'postgres', tenantId: ctxOrError.tenantId },
  };
});
