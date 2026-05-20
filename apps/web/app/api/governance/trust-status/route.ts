import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export const GET = createRoute(async (request: Request) => {
  if (!process.env.DATABASE_URL) {
    throw new Error('Database not available');
  }

  // Get the most recent model health snapshot
  const result = await query(`
    SELECT
      snapshot_date,
      system_health_status,
      model_trust_score,
      total_reviews_30d,
      total_rejections_30d,
      stale_approvals_count,
      expired_approvals_count,
      alert_message
    FROM model_health_ledger
    ORDER BY snapshot_date DESC
    LIMIT 1
  `);

  const snapshot = result.rows?.[0];

  // Return current trust status with configuration
  const trustStatus = {
    confidenceDecay: {
      active: true,
      decayHalfLifeDays: 30,
      approvalExpiryDays: 90,
    },
    seasonalityBaselines: {
      timeClassesTracked: 9,
      detectionFrequencies: ['weekly', 'monthly', 'quarterly'],
    },
    riskWeightedSampling: {
      auditFrequency: 'weekly',
      targetingStrategy: 'stable hallucinations',
    },
    currentHealth: {
      status: snapshot?.system_health_status || 'HEALTHY',
      modelTrustScore: snapshot?.model_trust_score || 1.0,
      totalReviews30d: snapshot?.total_reviews_30d || 0,
      totalRejections30d: snapshot?.total_rejections_30d || 0,
      staleApprovalsCount: snapshot?.stale_approvals_count || 0,
      expiredApprovalsCount: snapshot?.expired_approvals_count || 0,
      alertMessage: snapshot?.alert_message || null,
      asOf: snapshot?.snapshot_date || new Date().toISOString(),
    },
  };

  return {
    data: trustStatus,
    meta: { source: 'postgres' },
  };
});
