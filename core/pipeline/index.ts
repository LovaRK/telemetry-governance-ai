import { getSnapshots, getKpiMetrics } from '../../apps/api/repositories/telemetry-repository';
import { DecisionTraceCollector } from '../traceability/decision_trace';

export interface PipelineResult {
  timeline: Array<{ timestamp: string; agent: string; status: string; duration_ms: number }>;
  connection?: any;
  discovery?: any;
  context?: any;
  reasoning?: any;
  value?: any;
  prioritization?: any;
  composition?: any;
  error?: string;
  decision_trace?: any;
  telemetry_assets?: any[];
  summary?: any;
  kpis?: any;
}

/**
 * Pipeline that reads from cached PostgreSQL data.
 * This is the ONLY pipeline that should be used for display.
 * No MCP calls, no demo data.
 */
export async function runPipelineFromCache(): Promise<PipelineResult> {
  const timeline: PipelineResult['timeline'] = [];
  const result: PipelineResult = { timeline };
  const traceCollector = new DecisionTraceCollector();

  try {
    // STAGE 1: Load cached telemetry snapshots from PostgreSQL
    const start1 = Date.now();
    const snapshots = await getSnapshots({ limit: 100 });
    timeline.push({ 
      timestamp: new Date().toISOString(), 
      agent: 'Cache Loader', 
      status: snapshots.length > 0 ? 'completed' : 'empty', 
      duration_ms: Date.now() - start1 
    });
    
    traceCollector.addFromStage(
      'cache_loader',
      { requested: 100, cached: snapshots.length },
      { loaded: snapshots.length },
      snapshots.length > 0 
        ? `Loaded ${snapshots.length} telemetry snapshots from cache` 
        : 'No cached data found — refresh from Splunk to populate cache',
      snapshots.length > 0 ? [`Found ${snapshots.length} indices in cache`] : ['Cache is empty'],
      snapshots.length > 0 ? 0.95 : 0.1,
      Date.now() - start1
    );

    if (snapshots.length === 0) {
      throw new Error('No telemetry data found. Please click "Refresh from Splunk" first.');
    }

    // STAGE 2: Transform snapshots to telemetry assets format
    const start2 = Date.now();
    const telemetry_assets = snapshots.map(s => ({
      telemetry_asset: s.indexName,
      value_score: Math.max(0, 100 - s.riskScore),
      waste_score: s.riskScore,
      risk_score: s.riskScore,
      recommendation: { action: s.classification, priority: s.riskScore > 70 ? 'HIGH' : 'MEDIUM' },
      estimated_annual_cost: s.costPerYear,
      estimated_savings: s.classification === 'ELIMINATE' || s.classification === 'ARCHIVE' ? s.costPerYear : 0,
      confidence: s.confidence,
      scoring_breakdown: {
        waste_score: s.riskScore,
        derived_from: { 
          ingest_volume: s.dailyAvgGb * 10, 
          low_search_usage: s.utilizationPct < 20 ? 30 : 0, 
          duplicate_patterns: 0 
        }
      },
      evidence: s.evidence,
      sourcetype: s.sourcetype,
      daily_avg_gb: s.dailyAvgGb,
      utilization_pct: s.utilizationPct,
      cost_per_year: s.costPerYear,
      retention_days: s.retentionDays
    }));
    
    timeline.push({ 
      timestamp: new Date().toISOString(), 
      agent: 'Transformer', 
      status: 'completed', 
      duration_ms: Date.now() - start2 
    });
    
    traceCollector.addFromStage(
      'transformer',
      { snapshot_count: snapshots.length },
      { asset_count: telemetry_assets.length },
      `Transformed ${telemetry_assets.length} snapshots to agentic format`,
      ['Used classification from scoring service', 'Calculated estimated savings'],
      0.9,
      Date.now() - start2
    );

    // STAGE 3: Generate summary statistics
    const start3 = Date.now();
    const kpis = await getKpiMetrics();
    const summary = {
      totalAssets: telemetry_assets.length,
      keep: telemetry_assets.filter((a: any) => a.recommendation.action === 'KEEP').length,
      optimize: telemetry_assets.filter((a: any) => a.recommendation.action === 'OPTIMIZE').length,
      archive: telemetry_assets.filter((a: any) => a.recommendation.action === 'ARCHIVE').length,
      eliminate: telemetry_assets.filter((a: any) => a.recommendation.action === 'ELIMINATE').length,
      investigate: telemetry_assets.filter((a: any) => a.recommendation.action === 'INVESTIGATE').length,
      totalPotentialSavings: telemetry_assets.reduce((sum: number, a: any) => sum + (a.estimated_savings || 0), 0)
    };
    
    timeline.push({ 
      timestamp: new Date().toISOString(), 
      agent: 'Analyzer', 
      status: 'completed', 
      duration_ms: Date.now() - start3 
    });
    
    traceCollector.addFromStage(
      'analyzer',
      { asset_count: telemetry_assets.length },
      summary,
      `Generated summary: ${summary.keep} keep, ${summary.eliminate} eliminate, $${(summary.totalPotentialSavings/1000).toFixed(0)}k potential savings`,
      ['Calculated classification distribution', 'Summed potential savings'],
      0.85,
      Date.now() - start3
    );

    result.telemetry_assets = telemetry_assets;
    result.summary = summary;
    result.kpis = kpis;
    result.decision_trace = {
      decision_traces: traceCollector.getAll(),
      overall_confidence: traceCollector.getOverallConfidence(),
      trace_id: traceCollector.getTraceId()
    };

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Pipeline failed';
    traceCollector.addFromStage(
      'error',
      {},
      {},
      `Pipeline error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ['Check aggregation service', 'Verify PostgreSQL connection'],
      0,
      0
    );
    result.decision_trace = {
      decision_traces: traceCollector.getAll(),
      overall_confidence: 0,
      trace_id: traceCollector.getTraceId()
    };
  }

  return result;
}

