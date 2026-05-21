import { NextRequest, NextResponse } from 'next/server';
import { withTraceContext, initTraceFromRequest, getTraceId } from '@core/guards/trace-context';
import { pool, query } from '@core/database/connection';
import { ModelGovernanceService } from '@/lib/model-governance-service';

const governanceService = new ModelGovernanceService(pool);

export async function GET(req: NextRequest) {
  const traceId = initTraceFromRequest(req);

  return withTraceContext(traceId, async () => {
    try {
      const runtime = await governanceService.getActiveRuntime();
      const promotionRes = await query<{
        promotion_id: string;
        promoted_by: string | null;
        promoted_at: string | null;
      }>(
        `SELECT promotion_id, promoted_by, promoted_at
         FROM model_promotions
         WHERE promotion_id = $1
         LIMIT 1`,
        [runtime.promotionId]
      );

      const promotion = promotionRes.rows[0] || null;
      const diagnostics = governanceService.getDiagnostics();

      return NextResponse.json(
        {
          data: {
            runtime: {
              modelId: runtime.modelId,
              modelName: runtime.modelName,
              modelVersion: runtime.modelVersion,
              promptVersion: runtime.promptVersion,
              contractVersion: runtime.contractVersion,
              configVersion: runtime.configVersion,
            },
            promotion: {
              promotionId: runtime.promotionId,
              approvedBy: promotion?.promoted_by || null,
              promotedAt: promotion?.promoted_at || null,
            },
            cache: diagnostics,
          },
          meta: {
            source: 'postgres',
            mode: 'live',
            traceId,
          },
        },
        { status: 200 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('NO_ACTIVE_MODEL_POINTER')) {
        return NextResponse.json(
          {
            error: 'NO_ACTIVE_MODEL_POINTER',
            data: {
              runtime: null,
              promotion: null,
              cache: governanceService.getDiagnostics(),
            },
            meta: {
              source: 'system',
              mode: 'live',
              traceId: getTraceId(),
            },
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error: message,
          meta: {
            source: 'system',
            mode: 'live',
            traceId: getTraceId(),
          },
        },
        { status: 500 }
      );
    }
  });
}
