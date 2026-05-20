import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { pool } from '@core/database/connection';

interface BulkActionResult {
  indexName: string;
  previousAction: string;
  newAction: string;
  success: boolean;
  message: string;
  timestamp: Date;
}

async function applyBulkAction(
  client: any,
  indexNames: string[],
  action: string,
  reason?: string
): Promise<BulkActionResult[]> {
  const results: BulkActionResult[] = [];

  // Get current snapshot
  const snapshotResult = await client.query(
    'SELECT snapshot_id FROM telemetry_snapshots ORDER BY snapshot_date DESC LIMIT 1'
  );

  if (snapshotResult.rows.length === 0) {
    throw new Error('No snapshot available for bulk action');
  }

  const snapshotId = snapshotResult.rows[0].snapshot_id;

  // Process each index
  for (const indexName of indexNames) {
    try {
      // Get current decision
      const currentResult = await client.query(
        'SELECT action FROM agent_decisions WHERE snapshot_id = $1 AND index_name = $2 LIMIT 1',
        [snapshotId, indexName]
      );

      const previousAction = currentResult.rows[0]?.action || 'UNKNOWN';

      // Update the decision
      const updateResult = await client.query(
        `UPDATE agent_decisions
        SET action = $1, recommendation = $2, updated_at = NOW()
        WHERE snapshot_id = $3 AND index_name = $4
        RETURNING action`,
        [
          action,
          reason || `Bulk action applied: ${action}`,
          snapshotId,
          indexName,
        ]
      );

      if (updateResult.rows.length > 0) {
        results.push({
          indexName,
          previousAction,
          newAction: action,
          success: true,
          message: `Updated ${indexName} from ${previousAction} to ${action}`,
          timestamp: new Date(),
        });
      } else {
        results.push({
          indexName,
          previousAction,
          newAction: action,
          success: false,
          message: `Index not found in current snapshot`,
          timestamp: new Date(),
        });
      }
    } catch (err) {
      results.push({
        indexName,
        previousAction: 'UNKNOWN',
        newAction: action,
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date(),
      });
    }
  }

  return results;
}

export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const { indexNames, action, reason } = body;

  if (!indexNames || !Array.isArray(indexNames) || indexNames.length === 0) {
    throw new Error('indexNames must be a non-empty array');
  }

  if (!['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'S3_CANDIDATE'].includes(action)) {
    throw new Error('Invalid action. Must be one of: KEEP, OPTIMIZE, ARCHIVE, ELIMINATE, S3_CANDIDATE');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = await applyBulkAction(client, indexNames, action, reason);

    await client.query('COMMIT');

    const allSuccessful = (results as BulkActionResult[]).every(r => r.success);

    return {
      data: {
        success: allSuccessful,
        results,
        summary: {
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
      },
      meta: { source: 'postgres' },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const GET = createRoute(async () => {
  throw new Error('Bulk actions requires POST request');
});
