import { NextRequest, NextResponse } from 'next/server';
import { runPipelineFromCache } from '@core/pipeline/index';
import { getCacheStatus } from '@api/services/cache-service';

/**
 * GET /api/pipeline
 * Reads from cached PostgreSQL data (no MCP calls).
 * This is the primary endpoint for dashboard display.
 */
export async function GET(request: NextRequest) {
  try {
    // First check cache status
    const cache = await getCacheStatus('index_metrics');
    
    // Run pipeline from cache (reads from PostgreSQL only)
    const result = await runPipelineFromCache();

    // Format response
    const assets = result.telemetry_assets || [];
    const summary = result.summary || {
      totalAssets: 0,
      keep: 0,
      optimize: 0,
      archive: 0,
      eliminate: 0,
      investigate: 0,
      totalPotentialSavings: 0
    };

    return NextResponse.json({
      timeline: result.timeline,
      telemetry_assets: assets,
      summary: {
        ...summary,
        dataFreshness: cache.lastRefreshAt 
          ? Math.floor((Date.now() - new Date(cache.lastRefreshAt).getTime()) / 1000) 
          : null
      },
      kpis: result.kpis,
      decision_trace: result.decision_trace,
      error: result.error,
      cacheStatus: {
        status: cache.status,
        isStale: cache.isStale,
        lastRefreshAt: cache.lastRefreshAt,
        recordCount: cache.recordCount
      },
      requiresRefresh: !cache.recordCount || cache.isStale
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Pipeline failed' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/pipeline
 * This endpoint is DEPRECATED.
 * Use POST /api/cache to trigger Splunk refresh instead.
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { 
      error: 'Direct pipeline execution is deprecated. Use POST /api/cache to refresh data from Splunk.',
      hint: 'POST /api/cache with { mcpUrl: "...", token: "..." } to fetch and aggregate data'
    },
    { status: 410 }
  );
}