import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { governanceCausalityService } from '@/services/governance-causality-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * POST /api/governance/mutation-lifecycle
 *
 * Record a mutation lifecycle state transition
 * Tracks 10-stage progression: INTENT_RECEIVED → OPERATOR_ACKNOWLEDGED
 *
 * Request body:
 * {
 *   "correlationId": "corr_...",
 *   "lifecycleState": "INTENT_RECEIVED" | "MUTATION_DISPATCHED" | ... | "OPERATOR_ACKNOWLEDGED",
 *   "previousState": "INTENT_RECEIVED",
 *   "stateTransitionReason": "User clicked approve button",
 *   "durationInStateMs": 120,
 *   "errorCode": null,
 *   "errorMessage": null,
 *   "triggeringEventId": "evt_..."
 * }
 *
 * Response:
 * {
 *   "eventId": "evt_...",
 *   "recorded": true
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

    // Validate lifecycle state
    const validStates = [
      'INTENT_RECEIVED',
      'MUTATION_DISPATCHED',
      'API_ACCEPTED',
      'STATE_PERSISTED',
      'AUDIT_SNAPSHOTTED',
      'QUERY_INVALIDATED',
      'CACHE_REFRESH_REQUESTED',
      'QUERY_REFETCHED',
      'UI_RECONCILED',
      'OPERATOR_ACKNOWLEDGED',
    ];

    if (!validStates.includes(body.lifecycleState)) {
      return NextResponse.json(
        { error: `Invalid lifecycle state: ${body.lifecycleState}` },
        { status: 400 }
      );
    }

    // Create lifecycle event
    const lifecycleEvent = governanceCausalityService.createLifecycleEvent(
      body.correlationId,
      body.lifecycleState,
      body.previousState,
      body.durationInStateMs,
      {
        code: body.errorCode,
        message: body.errorMessage,
      }
    );

    // Record to mutation_lifecycle_events
    const client = await pool.connect();
    try {
      await client.query(
        `
        INSERT INTO mutation_lifecycle_events (
          event_id,
          correlation_id,
          lifecycle_state,
          previous_state,
          state_transition_reason,
          entered_at,
          duration_in_state_ms,
          error_code,
          error_message,
          triggering_event_id,
          recorded_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
        )
        `,
        [
          lifecycleEvent.eventId,
          lifecycleEvent.correlationId,
          lifecycleEvent.lifecycleState,
          lifecycleEvent.previousState || null,
          body.stateTransitionReason || null,
          lifecycleEvent.enteredAt,
          lifecycleEvent.durationInStateMs || null,
          lifecycleEvent.errorCode || null,
          lifecycleEvent.errorMessage || null,
          body.triggeringEventId || null,
        ]
      );
    } finally {
      client.release();
    }

    return NextResponse.json(
      {
        eventId: lifecycleEvent.eventId,
        recorded: true,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error recording mutation lifecycle event:', error);
    return NextResponse.json(
      { error: 'Failed to record mutation lifecycle event' },
      { status: 500 }
    );
  }
}
