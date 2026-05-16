import { NextRequest, NextResponse } from 'next/server';
import { getConnectionPool } from '../../../lib/db';
import {
  getDecisionHistory,
  getConfigAuditTrail,
  getCurrentLLMPromptVersion,
} from '../../../services/decision-history-service';

export async function GET(request: NextRequest) {
  try {
    const pool = await getConnectionPool();
    const client = await pool.connect();

    try {
      const searchParams = request.nextUrl.searchParams;
      const type = searchParams.get('type') || 'decisions'; // 'decisions', 'config', 'prompt'
      const indexName = searchParams.get('index');
      const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

      if (type === 'decisions') {
        const history = await getDecisionHistory(client, indexName || undefined, limit, offset);
        return NextResponse.json({
          success: true,
          type: 'decision_history',
          data: history,
          count: history.length,
          hasMore: history.length === limit,
        });
      } else if (type === 'config') {
        const auditTrail = await getConfigAuditTrail(client, limit, offset);
        return NextResponse.json({
          success: true,
          type: 'config_audit',
          data: auditTrail,
          count: auditTrail.length,
          hasMore: auditTrail.length === limit,
        });
      } else if (type === 'prompt') {
        const promptVersion = await getCurrentLLMPromptVersion(client);
        return NextResponse.json({
          success: true,
          type: 'llm_prompt_version',
          data: promptVersion,
        });
      } else {
        return NextResponse.json(
          { error: 'Invalid type parameter' },
          { status: 400 }
        );
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[decision-history API]', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to fetch decision history',
      },
      { status: 500 }
    );
  }
}
