import { NextRequest, NextResponse } from 'next/server';
import { getConnectionPool } from '../../../lib/db';
import {
  applyBulkAction,
  getBulkActionPreview,
  exportBulkRecommendations,
  BulkActionRequest,
} from '../../../services/bulk-actions-service';

export async function POST(request: NextRequest) {
  try {
    const pool = await getConnectionPool();
    const client = await pool.connect();

    try {
      const body = await request.json();
      const { operation, indexNames, action, reason, userId, format } = body;

      if (!operation || !indexNames || !Array.isArray(indexNames)) {
        return NextResponse.json(
          { error: 'Missing required fields: operation, indexNames (array)' },
          { status: 400 }
        );
      }

      if (operation === 'apply') {
        if (!action) {
          return NextResponse.json(
            { error: 'Missing required field: action' },
            { status: 400 }
          );
        }

        const bulkRequest: BulkActionRequest = {
          indexNames,
          action: action as any,
          reason,
          userId,
        };

        const results = await applyBulkAction(client, bulkRequest);

        const successCount = results.filter(r => r.success).length;
        return NextResponse.json({
          success: true,
          operation: 'bulk_apply',
          totalIndexes: indexNames.length,
          successCount,
          failureCount: indexNames.length - successCount,
          results,
        });
      } else if (operation === 'preview') {
        if (!action) {
          return NextResponse.json(
            { error: 'Missing required field: action' },
            { status: 400 }
          );
        }

        const preview = await getBulkActionPreview(client, indexNames, action);
        const totalSavings = preview.reduce((sum, p) => sum + p.savingsImpact, 0);

        return NextResponse.json({
          success: true,
          operation: 'bulk_preview',
          indexCount: preview.length,
          proposedAction: action,
          estimatedTotalSavings: totalSavings,
          preview,
        });
      } else if (operation === 'export') {
        const exportFormat = format === 'csv' ? 'csv' : 'json';
        const content = await exportBulkRecommendations(client, indexNames, exportFormat);

        const mimeType = exportFormat === 'csv' ? 'text/csv' : 'application/json';
        const filename = `bulk-recommendations-${Date.now()}.${exportFormat}`;

        return new NextResponse(content, {
          headers: {
            'Content-Type': mimeType,
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      } else {
        return NextResponse.json(
          { error: 'Invalid operation. Must be: apply, preview, or export' },
          { status: 400 }
        );
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[bulk-actions API]', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to process bulk action',
      },
      { status: 500 }
    );
  }
}
