import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { GovernanceTelemetryService } from '@/services/governance-telemetry-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * GET /api/governance/events
 *
 * Real-time event stream for monitoring and alerting
 * Returns recent governance events with severity levels
 *
 * Query parameters:
 * - limit: Max events to return (default: 100, max: 1000)
 * - severity: Filter by severity (ERROR, COLLISION, SUCCESS, INFO)
 *
 * Response:
 * {
 *   "events": [
 *     {
 *       "eventId": "uuid",
 *       "indexName": "my_index",
 *       "eventType": "GOVERNANCE_VERSION_COLLISION",
 *       "reviewerId": "user@example.com",
 *       "apiResponseCode": 409,
 *       "apiErrorCode": "STATE_VERSION_MISMATCH",
 *       "blockingReason": "Expected version abc123..., got def456...",
 *       "timestamp": "2026-05-18T12:30:45Z",
 *       "severity": "COLLISION"
 *     }
 *   ],
 *   "total": 542,
 *   "last_update": "2026-05-18T12:35:00Z"
 * }
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        {
          events: [],
          total: 0,
          last_update: new Date().toISOString(),
        },
        { status: 200 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 1000);
    const severity = searchParams.get('severity');

    const telemetryService = new GovernanceTelemetryService(pool);
    let events = await telemetryService.getEventsStream(limit);

    // Filter by severity if requested
    if (severity) {
      events = events.filter((e) => e.event_severity === severity.toUpperCase());
    }

    return NextResponse.json(
      {
        events: events.map((e) => ({
          eventId: e.event_id,
          indexName: e.index_name,
          eventType: e.event_type,
          fromState: e.from_state,
          toState: e.to_state,
          reviewerId: e.reviewer_id,
          apiResponseCode: e.api_response_code,
          apiErrorCode: e.api_error_code,
          blockingReason: e.blocking_reason,
          timestamp: e.recorded_at,
          severity: e.event_severity,
        })),
        total: events.length,
        last_update: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching events stream:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events stream' },
      { status: 500 }
    );
  }
}
