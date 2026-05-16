import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    // Primary truth: cache_metadata row set by the aggregation pipeline after every refresh
    const cacheRes = await query(`
      SELECT last_refresh_at, next_refresh_at, status, record_count
      FROM cache_metadata
      WHERE cache_key = 'index_metrics'
      LIMIT 1
    `);

    const hasEverRefreshed = cacheRes.rows.length > 0 && cacheRes.rows[0].last_refresh_at !== null;

    if (!hasEverRefreshed) {
      return NextResponse.json({
        hasEverRefreshed: false,
        hasData: false,
        hasAgentDecisions: false,
        status: 'empty',
        lastRefreshAt: null,
        nextRefreshAt: null,
        recordCount: 0,
        message: 'Connect to Splunk and run a refresh to populate data.',
      });
    }

    const row = cacheRes.rows[0];
    const now = new Date();
    const nextRefresh = row.next_refresh_at ? new Date(row.next_refresh_at) : null;
    const isStale = nextRefresh ? now > nextRefresh : false;
    const status = isStale ? 'stale' : (row.status || 'fresh');

    // Check whether LLM decisions exist for the current snapshot
    const agentRes = await query(`
      SELECT COUNT(*) AS cnt FROM agent_decisions
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM agent_decisions)
    `).catch(() => ({ rows: [{ cnt: '0' }] }));
    const hasAgentDecisions = parseInt(agentRes.rows[0]?.cnt ?? '0', 10) > 0;

    return NextResponse.json({
      hasEverRefreshed: true,
      hasData: true,
      hasAgentDecisions,
      status,
      lastRefreshAt: row.last_refresh_at,
      nextRefreshAt: row.next_refresh_at,
      recordCount: row.record_count ?? 0,
      message: isStale ? 'Data may be stale — refresh recommended.' : 'Dashboard data is ready.',
    });
  } catch {
    return NextResponse.json({
      hasEverRefreshed: false,
      hasData: false,
      hasAgentDecisions: false,
      status: 'error',
      lastRefreshAt: null,
      nextRefreshAt: null,
      recordCount: 0,
      message: 'Cache status check failed.',
    }, { status: 500 });
  }
}
