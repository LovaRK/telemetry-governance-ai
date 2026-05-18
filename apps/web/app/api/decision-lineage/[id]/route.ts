import { NextResponse } from 'next/server';

let transaction: any = null;
let updateDecisionWithCalibration: any = null;

try {
  const conn = require('@core/database/connection');
  transaction = conn.transaction;
  const service = require('@api/services/decision-lineage-service');
  updateDecisionWithCalibration = service.updateDecisionWithCalibration;
} catch {
  // Database module not available in web-only mode
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!transaction || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        missingDependency: 'PostgreSQL'
      }, { status: 503 });
    }

    const body = await request.json();
    const { action, reviewedBy, dismissalReason, factId } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    if (!reviewedBy) {
      return NextResponse.json(
        { error: 'reviewedBy is required' },
        { status: 400 }
      );
    }

    if (!factId) {
      return NextResponse.json(
        { error: 'factId is required for calibration' },
        { status: 400 }
      );
    }

    const reviewAction = action === 'approve' ? 'APPROVE' : 'REJECT';

    await transaction(async (client: any) => {
      await updateDecisionWithCalibration(
        client,
        params.id,
        factId,
        reviewAction,
        reviewedBy,
        dismissalReason || undefined
      );
    });

    const newStatus = action === 'approve' ? 'APPLIED' : 'DISMISSED';

    return NextResponse.json({
      mode: 'FULL_STACK',
      success: true,
      message: `Decision ${params.id} ${action}ed with human calibration applied`,
      newStatus,
      reviewAction,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API] Decision status update error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
