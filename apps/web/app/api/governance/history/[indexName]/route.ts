import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { GovernanceTelemetryService } from '@/services/governance-telemetry-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * GET /api/governance/history/:indexName
 *
 * Audit trail replay for a specific index
 * Returns complete history of governance state changes, mutations, errors
 *
 * Query parameters:
 * - startTime: ISO 8601 datetime (default: 24 hours ago)
 * - endTime: ISO 8601 datetime (default: now)
 * - eventType: Filter by event type (optional)
 * - reviewerId: Filter by reviewer (optional)
 *
 * Response:
 * {
 *   "indexName": "my_index",
 *   "historyStart": "2026-05-18T00:00:00Z",
 *   "historyEnd": "2026-05-18T23:59:59Z",
 *   "events": [
 *     {
 *       "eventId": "uuid",
 *       "eventType": "GOVERNANCE_STATE_TRANSITION",
 *       "fromState": "PROPOSED",
 *       "toState": "APPROVED",
 *       "effectiveConfidence": 0.87,
 *       "confidenceBand": "TRUSTED",
 *       "reviewerId": "user@example.com",
 *       "apiResponseCode": 200,
 *       "timestamp": "2026-05-18T12:30:45Z"
 *     }
 *   ],
 *   "trustScoreProgression": [
 *     { timestamp: "2026-05-18T12:00:00Z", confidence: 0.65, band: "RELIABLE" },
 *     { timestamp: "2026-05-18T12:30:00Z", confidence: 0.87, band: "TRUSTED" }
 *   ],
 *   "mutations": { total: 5, successful: 4, failed: 1 },
 *   "errors": { versionCollisions: 1, invalidationFailures: 0 }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { indexName: string } }
) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const indexName = decodeURIComponent(params.indexName);
    const searchParams = request.nextUrl.searchParams;

    // Parse time range
    const endTime = searchParams.get('endTime') ? new Date(searchParams.get('endTime')!) : new Date();
    const startTime = searchParams.get('startTime')
      ? new Date(searchParams.get('startTime')!)
      : new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    const telemetryService = new GovernanceTelemetryService(pool);
    const { events, mutations, errors } = await telemetryService.getAuditHistory(indexName, startTime, endTime);

    // Calculate trust score progression (extract state transitions and confidence changes)
    const progression = events
      .filter((e) => e.event_type === 'GOVERNANCE_STATE_TRANSITION')
      .map((e) => ({
        timestamp: e.recorded_at,
        confidence: e.effective_confidence,
        band: e.confidence_band,
        state: e.to_state,
      }))
      .reverse(); // Chronological order

    return NextResponse.json(
      {
        indexName,
        historyStart: startTime.toISOString(),
        historyEnd: endTime.toISOString(),
        events: events.map((e) => ({
          eventId: e.journal_id,
          eventType: e.event_type,
          fromState: e.from_state,
          toState: e.to_state,
          actionIntent: e.action_intent,
          effectiveConfidence: e.effective_confidence,
          confidenceBand: e.confidence_band,
          governanceCap: e.governance_cap,
          reviewerId: e.reviewer_id,
          apiResponseCode: e.api_response_code,
          apiErrorCode: e.api_error_code,
          clientLatencyMs: e.client_mutation_duration_ms,
          apiLatencyMs: e.api_response_duration_ms,
          blockingReason: e.blocking_reason,
          timestamp: e.recorded_at,
        })),
        trustScoreProgression: progression,
        mutations,
        errors,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching audit history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit history' },
      { status: 500 }
    );
  }
}
