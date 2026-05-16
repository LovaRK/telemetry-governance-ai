import { Client } from 'pg';

export interface BulkActionRequest {
  indexNames: string[];
  action: 'KEEP' | 'OPTIMIZE' | 'ARCHIVE' | 'ELIMINATE' | 'S3_CANDIDATE';
  reason?: string;
  userId?: string;
}

export interface BulkActionResult {
  indexName: string;
  previousAction: string;
  newAction: string;
  success: boolean;
  message: string;
  timestamp: Date;
}

export async function applyBulkAction(
  client: Client,
  request: BulkActionRequest
): Promise<BulkActionResult[]> {
  const results: BulkActionResult[] = [];

  // Get current snapshot to use for updates
  const snapshotResult = await client.query(
    'SELECT id FROM telemetry_snapshots ORDER BY snapshot_date DESC LIMIT 1'
  );

  if (snapshotResult.rows.length === 0) {
    throw new Error('No snapshot available for bulk action');
  }

  const snapshotId = snapshotResult.rows[0].id;

  // Process each index
  for (const indexName of request.indexNames) {
    try {
      // Get current decision for this index
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
          request.action,
          request.reason || `Bulk action applied: ${request.action}`,
          snapshotId,
          indexName,
        ]
      );

      // Log the bulk action change
      if (updateResult.rows.length > 0) {
        await client.query(
          `INSERT INTO decision_history
          (snapshot_id, snapshot_date, index_name, action_previous, action_current, change_reason)
          SELECT $3, CURRENT_DATE, $4, $5, $6, $7
          FROM telemetry_snapshots WHERE id = $3`,
          [null, null, snapshotId, indexName, previousAction, request.action, `Bulk action by ${request.userId || 'system'}: ${request.reason || ''}`]
        );

        results.push({
          indexName,
          previousAction,
          newAction: request.action,
          success: true,
          message: `Updated ${indexName} from ${previousAction} to ${request.action}`,
          timestamp: new Date(),
        });
      } else {
        results.push({
          indexName,
          previousAction,
          newAction: request.action,
          success: false,
          message: `Index not found in current snapshot`,
          timestamp: new Date(),
        });
      }
    } catch (err) {
      results.push({
        indexName,
        previousAction: 'UNKNOWN',
        newAction: request.action,
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date(),
      });
    }
  }

  return results;
}

export async function getBulkActionPreview(
  client: Client,
  indexNames: string[],
  proposedAction: string
): Promise<Array<{ indexName: string; currentAction: string; currentTier: string; savingsImpact: number }>> {
  if (indexNames.length === 0) return [];

  const placeholders = indexNames.map((_, i) => `$${i + 1}`).join(',');
  const result = await client.query(
    `SELECT index_name, action, tier, estimated_savings
    FROM agent_decisions
    WHERE index_name IN (${placeholders})
    ORDER BY snapshot_date DESC
    LIMIT 1`,
    indexNames
  );

  return result.rows.map(row => ({
    indexName: row.index_name,
    currentAction: row.action,
    currentTier: row.tier,
    savingsImpact: row.estimated_savings || 0,
  }));
}

export async function exportBulkRecommendations(
  client: Client,
  indexNames: string[],
  format: 'json' | 'csv' = 'json'
): Promise<string> {
  if (indexNames.length === 0) throw new Error('No indexes selected');

  const placeholders = indexNames.map((_, i) => `$${i + 1}`).join(',');
  const result = await client.query(
    `SELECT
      index_name, tier, action, recommendation, confidence_score, estimated_savings
    FROM agent_decisions
    WHERE index_name IN (${placeholders})
    ORDER BY estimated_savings DESC`,
    indexNames
  );

  if (format === 'csv') {
    const headers = ['Index Name', 'Tier', 'Action', 'Recommendation', 'Confidence', 'Est. Savings'];
    const rows = result.rows.map(row =>
      [
        `"${row.index_name}"`,
        row.tier,
        row.action,
        `"${(row.recommendation || '').replace(/"/g, '""')}"`,
        row.confidence_score,
        row.estimated_savings,
      ].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  } else {
    return JSON.stringify(
      result.rows.map(row => ({
        indexName: row.index_name,
        tier: row.tier,
        action: row.action,
        recommendation: row.recommendation,
        confidence: row.confidence_score,
        estimatedSavings: row.estimated_savings,
      })),
      null,
      2
    );
  }
}
