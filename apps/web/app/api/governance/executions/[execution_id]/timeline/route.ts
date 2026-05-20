/**
 * Timeline Replay Endpoint: Complete Execution Narrative Reconstruction
 *
 * Implements deterministic event replay with sequence integrity auditing.
 * Returns the complete immutable history of an execution, flagging any anomalies
 * (gaps, duplicates, out-of-order sequences) that would indicate ledger corruption.
 *
 * This endpoint is the foundation for:
 * - Frontend hydration (bootstrap UI with full historical state)
 * - Audit trail queries (compliance and forensic analysis)
 * - State reconstruction (replay events to compute execution state at any point)
 *
 * Response: JSON with full timeline + integrity metadata
 */

import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { getExecutionTimeline } from '@core/database/pipeline-events';

export const GET = createRoute(async (
  request: NextRequest,
  { params }: { params: { execution_id: string } }
) => {
  const { execution_id } = params;

  // Retrieve full event sequence from canonical ledger
  const events = await getExecutionTimeline(execution_id);

  if (!events || events.length === 0) {
    throw new Error('Execution timeline not found');
  }

  // =========================================================================
  // SEQUENCE INTEGRITY AUDITING
  // =========================================================================
  // Detect gaps, duplicates, or out-of-order writes in the event sequence.
  // If any anomaly is detected, flag the timeline as COMPROMISED.

  let timelineIntegrityStatus = 'INTEG_OK';
  const sequences = events.map(e => e.sequence);

  // Check monotonic ordering: each sequence must be exactly 1 greater than previous
  for (let i = 0; i < sequences.length; i++) {
    if (i > 0) {
      if (sequences[i] < sequences[i - 1]) {
        // Out-of-order write detected
        timelineIntegrityStatus = 'INTEG_COMPROMISED_OUT_OF_ORDER';
        break;
      }
      if (sequences[i] === sequences[i - 1]) {
        // Duplicate sequence number detected
        timelineIntegrityStatus = 'INTEG_COMPROMISED_DUPLICATE';
        break;
      }
      if (sequences[i] !== sequences[i - 1] + 1) {
        // Gap in sequence detected
        timelineIntegrityStatus = 'INTEG_COMPROMISED_GAP';
        break;
      }
    }
  }

  // Extract execution metadata from baseline event
  const baselineEvent = events[0];
  const finalEvent = events[events.length - 1];

  return {
    data: {
      execution_id,
      correlation_id: baselineEvent.correlation_id,
      actor: baselineEvent.actor,
      operator_session_id: baselineEvent.operator_session_id,

      // Timeline metadata
      total_events: events.length,
      first_event_at: baselineEvent.timestamp,
      last_event_at: finalEvent.timestamp,
      duration_ms: new Date(finalEvent.timestamp).getTime() - new Date(baselineEvent.timestamp).getTime(),

      // Integrity status — critical for detecting ledger anomalies
      timeline_integrity_status: timelineIntegrityStatus,
      integrity_details: {
        expected_sequence_count: events[events.length - 1]?.sequence || 0,
        actual_sequence_count: events.length,
        sequences_verified: sequences,
      },

      // Full immutable event history
      timeline: events.map(evt => ({
        sequence: evt.sequence,
        event_id: evt.event_id,
        event_type: evt.event_type,
        taxonomy: evt.taxonomy,
        severity: evt.severity,
        actor: evt.actor,
        message: evt.message,
        payload: evt.payload,
        governance: evt.governance,
        timestamp: evt.timestamp,
        created_at: evt.created_at,
      })),
    },
    meta: { source: 'postgres' },
  };
});
