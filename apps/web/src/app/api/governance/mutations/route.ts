import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { GovernanceTelemetryService } from '@/services/governance-telemetry-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * POST /api/governance/mutations
 *
 * Record a governance mutation event
 * Used by client mutation hooks to log all governance actions
 *
 * Request body:
 * {
 *   "indexName": "my_index",
 *   "eventType": "GOVERNANCE_STATE_TRANSITION",
 *   "fromState": "PROPOSED",
 *   "toState": "APPROVED",
 *   "actionIntent": "approve_decision",
 *   "reviewerId": "user@example.com",
 *   "clientMutationDurationMs": 245,
 *   "apiResponseCode": 200,
 *   "apiResponseDurationMs": 150,
 *   "effectiveConfidence": 0.87,
 *   "confidenceBand": "TRUSTED",
 *   "mutationId": "550e8400-e29b-41d4-a716-446655440000"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();

    const telemetryService = new GovernanceTelemetryService(pool);

    const eventId = await telemetryService.recordMutationEvent({
      indexName: body.indexName,
      eventType: body.eventType,
      actionIntent: body.actionIntent,
      fromState: body.fromState,
      toState: body.toState,
      mutationId: body.mutationId,
      reviewerId: body.reviewerId,
      clientInitiatedAt: body.clientInitiatedAt ? new Date(body.clientInitiatedAt) : undefined,
      clientMutationDurationMs: body.clientMutationDurationMs,
      apiResponseCode: body.apiResponseCode,
      apiErrorCode: body.apiErrorCode,
      apiResponseDurationMs: body.apiResponseDurationMs,
      effectiveConfidence: body.effectiveConfidence,
      confidenceBand: body.confidenceBand,
      governanceCap: body.governanceCap,
      isCapped: body.isCapped,
      expectedVersion: body.expectedVersion,
      actualVersion: body.actualVersion,
      recoveryScore: body.recoveryScore,
      consecutiveStableDays: body.consecutiveStableDays,
      operatorSessionId: body.operatorSessionId,
      blockingReason: body.blockingReason,
    });

    return NextResponse.json(
      { eventId, recorded: true },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error recording mutation event:', error);
    return NextResponse.json(
      { error: 'Failed to record mutation event' },
      { status: 500 }
    );
  }
}
