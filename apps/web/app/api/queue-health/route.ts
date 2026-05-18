import { NextResponse } from 'next/server';

let query: any = null;

try {
  const conn = require('@core/database/connection');
  query = conn.query;
} catch {
  // Database module not available in web-only mode
}

export async function GET(request: Request) {
  try {
    if (!query || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        missingDependency: 'PostgreSQL',
        data: null
      }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '30', 10);

    const res = await query(`
      SELECT
        id,
        snapshot_date,
        snapshot_id,
        reuse_ratio,
        unchanged_indexes,
        total_indexes,
        queue_depth,
        queue_depth_max_observed,
        processing_time_p95_ms,
        decision_flip_rate,
        flip_count,
        unstable_decisions,
        candidates_sent_to_ai,
        filtering_efficiency_pct,
        avg_inference_latency_ms,
        worker_memory_peak_mb,
        worker_count_active,
        high_confidence_proposals,
        medium_confidence_proposals,
        low_confidence_proposals,
        created_at
      FROM queue_health_metrics
      ORDER BY snapshot_date DESC
      LIMIT $1
    `, [limit]);

    const metrics = (res.rows || []).map((m: any) => ({
      id: m.id,
      snapshotDate: m.snapshot_date,
      snapshotId: m.snapshot_id,
      reuseRatio: parseFloat(m.reuse_ratio) || 0,
      unchangedIndexes: m.unchanged_indexes,
      totalIndexes: m.total_indexes,
      queueDepth: m.queue_depth,
      queueDepthMaxObserved: m.queue_depth_max_observed,
      processingTimeP95Ms: m.processing_time_p95_ms,
      decisionFlipRate: parseFloat(m.decision_flip_rate) || 0,
      flipCount: m.flip_count,
      unstableDecisions: m.unstable_decisions,
      candidatesSentToAi: m.candidates_sent_to_ai,
      filteringEfficiencyPct: parseFloat(m.filtering_efficiency_pct) || 0,
      avgInferenceLatencyMs: m.avg_inference_latency_ms,
      workerMemoryPeakMb: m.worker_memory_peak_mb,
      workerCountActive: m.worker_count_active,
      highConfidenceProposals: m.high_confidence_proposals,
      mediumConfidenceProposals: m.medium_confidence_proposals,
      lowConfidenceProposals: m.low_confidence_proposals,
      createdAt: m.created_at,
    }));

    return NextResponse.json({
      mode: 'FULL_STACK',
      data: metrics
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API] Queue health error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
