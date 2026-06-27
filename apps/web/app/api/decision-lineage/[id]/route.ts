import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { transaction } from '@core/database/connection';
import { updateDecisionWithCalibration as updateDecisionWithCalibrationService } from '@api/services/decision-lineage-service';

export const POST = createRoute(async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  if (!process.env.DATABASE_URL) {
    throw new Error('Database not available');
  }

  const body = await request.json();
  const { action, reviewedBy, dismissalReason, factId } = body;

  if (!action || !['approve', 'reject'].includes(action)) {
    throw new Error('Invalid action. Must be "approve" or "reject"');
  }

  if (!reviewedBy) {
    throw new Error('reviewedBy is required');
  }

  if (!factId) {
    throw new Error('factId is required for calibration');
  }

  const reviewAction = action === 'approve' ? 'APPROVE' : 'REJECT';

  await transaction(async (client: any) => {
    await updateDecisionWithCalibrationService(
      client,
      id,
      factId,
      reviewAction,
      reviewedBy,
      dismissalReason || undefined
    );
  });

  const newStatus = action === 'approve' ? 'APPLIED' : 'DISMISSED';

  return {
    data: {
      mode: 'FULL_STACK',
      success: true,
      message: `Decision ${id} ${action}ed with human calibration applied`,
      newStatus,
      reviewAction,
      timestamp: new Date().toISOString()
    },
    meta: { source: 'system' },
  };
});
