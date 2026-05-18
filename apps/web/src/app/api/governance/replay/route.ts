import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { governanceCausalityService } from '@/services/governance-causality-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * POST /api/governance/replay
 *
 * Authorize and execute a mutation replay within specified scope
 * Enforces triple-gate authorization: RBAC, temporal boundary, state-match
 *
 * Request body:
 * {
 *   "requesterId": "user@example.com",
 *   "requesterRole": "SUPER_COMPLIANCE_OPERATOR" | "ADMIN" | "AUDIT_REVIEWER",
 *   "targetSnapshotId": "snap_...",
 *   "targetIndexName": "my_index",
 *   "replayScope": "READ_ONLY" | "SANDBOX" | "SIMULATION" | "PROJECTION_REBUILD" | "LIVE_RECONCILIATION",
 *   "expectedSnapshotVersion": "v1.2.3"
 * }
 *
 * Response:
 * {
 *   "replayId": "rpl_...",
 *   "authorized": true,
 *   "gate1RbacPassed": true,
 *   "gate2TemporalPassed": true,
 *   "gate3StateMatchPassed": true,
 *   "replayStatus": "AUTHORIZED" | "DENIED",
 *   "denialReason": null,
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

    // Validate replay request
    const { requesterId, requesterRole, targetSnapshotId, targetIndexName, replayScope, expectedSnapshotVersion } = body;

    if (!requesterId || !requesterRole || !targetSnapshotId || !targetIndexName || !replayScope) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Enforce triple-gate authorization
    const authResult = governanceCausalityService.authorizeReplay({
      requesterId,
      requesterRole,
      targetSnapshotId,
      targetIndexName,
      replayScope,
      expectedSnapshotVersion,
    });

    const replayId = `rpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const replayStatus = authResult.authorized ? 'AUTHORIZED' : 'DENIED';

    // Record replay request and authorization gates to governance_replay_journal
    const client = await pool.connect();
    try {
      await client.query(
        `
        INSERT INTO governance_replay_journal (
          replay_id,
          requester_id,
          requester_role,
          target_snapshot_id,
          target_index_name,
          replay_scope,
          gate1_rbac_passed,
          gate2_temporal_passed,
          gate3_state_match_passed,
          expected_snapshot_version,
          version_match,
          snapshot_age_hours,
          max_replay_window_hours,
          replay_expired,
          replay_status,
          denial_reason,
          requested_at,
          recorded_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
        )
        `,
        [
          replayId,
          requesterId,
          requesterRole,
          targetSnapshotId,
          targetIndexName,
          replayScope,
          authResult.gate1RbacPassed,
          authResult.gate2TemporalPassed,
          authResult.gate3StateMatchPassed,
          expectedSnapshotVersion || null,
          authResult.authorized ? true : null,
          Math.floor(Date.now() / 1000 - parseInt(targetSnapshotId.slice(0, 10), 10)) / 3600,
          48,
          !authResult.gate2TemporalPassed,
          replayStatus,
          authResult.denialReason || null,
        ]
      );
    } finally {
      client.release();
    }

    // Return authorization result
    const statusCode = authResult.authorized ? 200 : 403;
    return NextResponse.json(
      {
        replayId,
        authorized: authResult.authorized,
        gate1RbacPassed: authResult.gate1RbacPassed,
        gate2TemporalPassed: authResult.gate2TemporalPassed,
        gate3StateMatchPassed: authResult.gate3StateMatchPassed,
        replayStatus,
        denialReason: authResult.denialReason || null,
        recorded: true,
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error('Error processing replay authorization:', error);
    return NextResponse.json(
      { error: 'Failed to process replay authorization' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/governance/replay?limit=50
 *
 * Query replay audit trail
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 250);

    const client = await pool.connect();
    try {
      const result = await client.query(
        `
        SELECT
          replay_id,
          requester_id,
          requester_role,
          target_index_name,
          replay_scope,
          gate1_rbac_passed,
          gate2_temporal_passed,
          gate3_state_match_passed,
          replay_status,
          denial_reason,
          requested_at,
          recorded_at
        FROM governance_replay_journal
        ORDER BY requested_at DESC
        LIMIT $1
        `,
        [limit]
      );

      return NextResponse.json(
        {
          replays: result.rows,
          count: result.rows.length,
        },
        { status: 200 }
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error querying replay audit trail:', error);
    return NextResponse.json(
      { error: 'Failed to query replay audit trail' },
      { status: 500 }
    );
  }
}
