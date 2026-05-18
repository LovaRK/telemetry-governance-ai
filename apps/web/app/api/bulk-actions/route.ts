import { NextRequest, NextResponse } from 'next/server';

let pool: any = null;
try {
  const conn = require('@core/database/connection');
  pool = conn.pool;
} catch {
  // Database module not available in web-only mode
}

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

export async function POST(request: NextRequest) {
  try {
    if (!pool) {
      return NextResponse.json(
        {
          mode: 'DEMO_MODE',
          error: 'Bulk actions not available',
          missingDependency: 'PostgreSQL',
          reason: 'Requires full-stack deployment with transaction support.',
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { indexNames, action, reason } = body;

    if (!indexNames || !Array.isArray(indexNames) || indexNames.length === 0) {
      return NextResponse.json(
        { error: 'indexNames must be a non-empty array' },
        { status: 400 }
      );
    }

    if (!['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'S3_CANDIDATE'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be one of: KEEP, OPTIMIZE, ARCHIVE, ELIMINATE, S3_CANDIDATE' },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const results = await applyBulkAction(client, indexNames, action, reason);

      await client.query('COMMIT');

      const allSuccessful = (results as BulkActionResult[]).every(r => r.success);

      return NextResponse.json({
        mode: 'FULL_STACK',
        success: allSuccessful,
        results,
        summary: {
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[bulk-actions] Error:', e);
    return NextResponse.json(
      {
        mode: 'DEMO_MODE',
        error: 'Bulk action failed',
        details: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Bulk actions requires POST request' },
    { status: 405 }
  );
}
