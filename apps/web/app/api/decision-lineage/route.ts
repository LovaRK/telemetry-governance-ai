import { NextResponse } from 'next/server';

let transaction: any = null;
let getPendingReviewDecisions: any = null;

try {
  const conn = require('@core/database/connection');
  transaction = conn.transaction;
  const service = require('@api/services/decision-lineage-service');
  getPendingReviewDecisions = service.getPendingReviewDecisions;
} catch {
  // Database module not available in web-only mode
}

export async function GET(request: Request) {
  try {
    if (!transaction || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        missingDependency: 'PostgreSQL',
        data: []
      }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const pendingDecisions = await transaction(async (client: any) => {
      return await getPendingReviewDecisions(client, limit);
    });

    return NextResponse.json({
      mode: 'FULL_STACK',
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
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API] Decision lineage review queue error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
