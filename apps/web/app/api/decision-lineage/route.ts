import { createRoute } from '@/lib/api-route-factory';
import { transaction } from '@core/database/connection';
import { getPendingReviewDecisions as getPendingReviewDecisionsService } from '@api/services/decision-lineage-service';

export const GET = createRoute(async (request: Request) => {
  if (!process.env.DATABASE_URL) {
    throw new Error('Database not available');
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const pendingDecisions = await transaction(async (client: any) => {
    return await getPendingReviewDecisionsService(client, limit);
  });

  return {
    data: pendingDecisions.map((d: any) => ({
      id: d.id,
      snapshotId: d.snapshot_id,
      indexName: d.index_name,
      sourcetype: d.sourcetype,
      deterministicSignals: d.deterministic_signals,
      cognitiveSignals: d.cognitive_signals,
      decisionStatus: d.decision_status,
      reviewedBy: d.reviewed_by,
      reviewedAt: d.reviewed_at,
      appliedAt: d.applied_at,
      dismissalReason: d.dismissal_reason,
    })),
    meta: { source: 'postgres' },
  };
});
