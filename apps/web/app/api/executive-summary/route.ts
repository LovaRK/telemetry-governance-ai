import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { ensurePipelineLedgerSchema, getLatestPublishedRun } from '@/lib/pipeline-ledger-service';
import { requireContext } from '@packages/auth/request-context';

export const GET = createRoute(async (request: NextRequest) => {
  await ensurePipelineLedgerSchema();

  // Require authentication - returns tenant-specific executive summary
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;
  const tenantId = context.tenantId;

  // Check for in-progress refresh (LOADING state)
  const loadingRunResult = await query(
    `SELECT run_id, status, started_at FROM pipeline_runs
     WHERE tenant_id = $1 AND status = 'PROCESSING'
     ORDER BY started_at DESC LIMIT 1`,
    [tenantId]
  );
  const loadingRun = loadingRunResult.rows?.[0];

  if (loadingRun) {
    const stage = 'TELEMETRY_INGESTION';
    return {
      loading: true,
      runId: loadingRun.run_id,
      stage,
      status: 'REFRESH_IN_PROGRESS',
      title: 'Refresh in progress',
      message: `Analyzing your telemetry (${stage})...`,
      meta: {
        source: 'postgres',
        tenantId,
        startedAt: loadingRun.started_at,
      },
    };
  }

  const publishedRun = await getLatestPublishedRun(tenantId);

  // Empty state: no published snapshot yet (not an error, valid application state)
  if (!publishedRun) {
    return {
      empty: true,
      status: 'NO_PUBLISHED_SNAPSHOT',
      summary: null,
      metrics: [],
      title: 'No executive summary available',
      message: 'Run a refresh to generate your first telemetry snapshot.',
      actions: [
        {
          label: 'Run Refresh',
          endpoint: '/api/cache',
        },
      ],
      data: {
        kpis: {
          roiScore: 0,
          gainScopeScore: 0,
          totalLicenseSpend: 0,
          licenseSpendLowValue: 0,
          storageSavingsPotential: 0,
          totalDailyGb: 0,
          totalSourcetypes: 0,
          tierCounts: { critical: 0, important: 0, niceToHave: 0, lowValue: 0 },
          securityGaps: 0,
          operationalGaps: 0,
          avgUtilization: 0,
          avgDetection: 0,
          avgQuality: 0,
          avgConfidence: 0,
        },
        quickWins: [],
        savingsStaircase: [],
        agentReasoning: '',
        snapshotDate: new Date().toISOString(),
        snapshots: [],
        decisions: [],
      },
      meta: {
        source: 'postgres',
        tenantId,
      },
    };
  }

  const snapshotId = publishedRun.snapshotId;

  const snapshotRowsResult = await query(
    `SELECT * FROM telemetry_snapshots
     WHERE tenant_id = $1 AND snapshot_id = $2
     ORDER BY index_name ASC, sourcetype ASC NULLS FIRST`,
    [tenantId, snapshotId]
  );
  const snapshotRows = snapshotRowsResult.rows || [];

  // Splunk unavailable: published run exists but no snapshots (data ingestion failed)
  if (snapshotRows.length === 0) {
    return {
      empty: true,
      status: 'SPLUNK_UNAVAILABLE',
      summary: null,
      metrics: [],
      reason: 'SPLUNK_UNAVAILABLE',
      title: 'Unable to load telemetry data',
      message: 'Splunk is currently unavailable. We will retry your refresh when service is restored.',
      retryable: true,
      actions: [
        {
          label: 'Retry Refresh',
          endpoint: '/api/cache',
        },
      ],
      data: {
        kpis: {
          roiScore: 0,
          gainScopeScore: 0,
          totalLicenseSpend: 0,
          licenseSpendLowValue: 0,
          storageSavingsPotential: 0,
          totalDailyGb: 0,
          totalSourcetypes: 0,
          tierCounts: { critical: 0, important: 0, niceToHave: 0, lowValue: 0 },
          securityGaps: 0,
          operationalGaps: 0,
          avgUtilization: 0,
          avgDetection: 0,
          avgQuality: 0,
          avgConfidence: 0,
        },
        quickWins: [],
        savingsStaircase: [],
        agentReasoning: '',
        snapshotDate: publishedRun.publishedAt || publishedRun.startedAt,
        snapshots: [],
        decisions: [],
      },
      meta: {
        source: 'postgres',
        tenantId,
        runId: publishedRun.runId,
        snapshotId: publishedRun.snapshotId,
      },
    };
  }

  const kpisResult = await query(
    `SELECT * FROM executive_kpis WHERE tenant_id = $1 AND snapshot_id = $2 LIMIT 1`,
    [tenantId, snapshotId]
  );
  const kpi = kpisResult.rows[0] || {};

  // Governance validation: active model pointer must exist (fail-fast)
  // Fall back to SYSTEM tenant if tenant-specific pointer doesn't exist
  const modelPointerResult = await query(
    `SELECT model_id, prompt_id FROM active_model_pointer
     WHERE tenant_id = $1 OR tenant_id = 'SYSTEM'
     ORDER BY tenant_id ASC LIMIT 1`,
    [tenantId]
  );

  if (!modelPointerResult.rows || modelPointerResult.rows.length === 0) {
    const traceId = request.headers.get('x-trace-id') || 'unknown';
    return NextResponse.json(
      {
        error: 'NO_ACTIVE_MODEL_POINTER',
        status: 'GOVERNANCE_MISSING',
        title: 'Governance configuration required',
        message: 'No active model/prompt configuration for this tenant. Governance setup is required before continuing.',
        empty: false,
        meta: {
          source: 'postgres',
          mode: 'live',
          tenantId,
          runId: publishedRun.runId,
          snapshotId: publishedRun.snapshotId,
          traceId,
        },
      },
      { status: 503 }
    );
  }

  const decisionsResult = await query(
    `SELECT ad.*,
            ra.status      AS gov_status,
            ra.action_note AS gov_note,
            ra.actor_email AS gov_actor,
            ra.updated_at  AS gov_updated_at
     FROM agent_decisions ad
     LEFT JOIN LATERAL (
       SELECT status, action_note, actor_email, updated_at
       FROM recommendation_actions
       WHERE index_name = ad.index_name
         AND (sourcetype = ad.sourcetype OR (sourcetype IS NULL AND ad.sourcetype IS NULL))
       ORDER BY updated_at DESC
       LIMIT 1
     ) ra ON true
     WHERE ad.tenant_id = $1 AND ad.snapshot_id = $2
     ORDER BY ad.composite_score DESC`,
    [tenantId, snapshotId]
  );
  const decisions = decisionsResult.rows || [];

  const tierCounts = {
    critical: decisions.filter((d: any) => d.tier?.toUpperCase() === 'CRITICAL').length,
    important: decisions.filter((d: any) => d.tier?.toUpperCase() === 'IMPORTANT').length,
    niceToHave: decisions.filter((d: any) => d.tier?.toUpperCase() === 'NICE_TO_HAVE' || d.tier?.toUpperCase() === 'NICE-TO-HAVE').length,
    lowValue: decisions.filter((d: any) => d.tier?.toUpperCase() === 'LOW_VALUE' || d.tier?.toUpperCase() === 'LOW-VALUE').length,
  };

  const totalDailyGbFromSnapshots = snapshotRows.reduce((sum: number, s: any) => sum + (parseFloat(s.daily_avg_gb) || 0), 0);
  const totalSourcetypesFromSnapshots = snapshotRows.length;
  const kpiTotalDailyGb = parseFloat(kpi?.total_daily_gb || '0');

  const decisionsByKey = new Map<string, any>();
  for (const d of decisions) {
    const key = `${d.index_name}::${d.sourcetype || ''}`;
    if (!decisionsByKey.has(key)) decisionsByKey.set(key, d);
  }

  return {
    data: {
      kpis: {
        roiScore: parseFloat(kpi?.roi_score || '0'),
        gainScopeScore: parseFloat(kpi?.gainscope_score || '0'),
        totalLicenseSpend: parseFloat(kpi?.total_license_spend || '0'),
        licenseSpendLowValue: parseFloat(kpi?.license_spend_low_value || '0'),
        storageSavingsPotential: parseFloat(kpi?.storage_savings_potential || '0'),
        totalDailyGb: kpiTotalDailyGb > 0 ? kpiTotalDailyGb : totalDailyGbFromSnapshots,
        totalSourcetypes: parseInt(kpi?.total_sourcetypes || String(totalSourcetypesFromSnapshots) || '0', 10),
        tierCounts,
        securityGaps: parseInt(kpi?.security_gaps || '0', 10),
        operationalGaps: parseInt(kpi?.operational_gaps || '0', 10),
        avgUtilization: parseFloat(kpi?.avg_utilization || '0'),
        avgDetection: parseFloat(kpi?.avg_detection || '0'),
        avgQuality: parseFloat(kpi?.avg_quality || '0'),
        avgConfidence: parseFloat(kpi?.avg_confidence || '0'),
      },
      snapshots: snapshotRows.map((snapshot: any) => {
        const key = `${snapshot.index_name}::${snapshot.sourcetype || ''}`;
        const d = decisionsByKey.get(key);
        return {
          snapshotId: snapshot.snapshot_id,
          indexName: snapshot.index_name,
          sourcetype: snapshot.sourcetype,
          granularity: snapshot.granularity,
          parentIndex: snapshot.parent_index,
          totalEvents: parseInt(snapshot.total_events || '0', 10),
          dailyAvgGb: parseFloat(snapshot.daily_avg_gb || '0'),
          retentionDays: parseInt(snapshot.retention_days || '90', 10),
          utilizationPct: parseFloat(snapshot.utilization_pct || '0'),
          costPerYear: parseFloat(snapshot.cost_per_year || '0'),
          riskScore: d ? parseFloat(d.risk_score || '0') : parseFloat(snapshot.risk_score || '0'),
          classification: snapshot.classification,
          confidence: d ? parseFloat(d.confidence || '0') : parseFloat(snapshot.confidence || '0'),
          recommendation: d?.recommendation || snapshot.recommendation,
          tier: d?.tier || snapshot.classification,
          action: d?.action || snapshot.classification || 'KEEP',
          reasoning: d?.reasoning || snapshot.raw_metadata?.reasoning || '',
          estimatedSavings: d ? (parseFloat(d.estimated_savings) || 0) : 0,
          compositeScore: d ? (parseFloat(d.composite_score) || 0) : 0,
          utilizationScore: d ? (parseFloat(d.utilization_score) || 0) : parseFloat(snapshot.utilization_pct || '0'),
          detectionScore: d ? (parseFloat(d.detection_score) || 0) : 0,
          qualityScore: d ? (parseFloat(d.quality_score) || 0) : 0,
          isQuickWin: Boolean(d?.is_quick_win),
          isS3Candidate: Boolean(d?.is_s3_candidate),
          detectionGap: Boolean(d?.detection_gap),
        };
      }),
      decisions: decisions.map((d: any) => ({
        index: d.index_name,
        sourcetype: d.sourcetype,
        tier: d.tier,
        action: d.action,
        confidence: d.confidence,
        confidenceScore: d.confidence_score,
        utilization: d.utilization_score,
        detection: d.detection_score,
        quality: d.quality_score,
        risk: d.risk_score,
        savings: d.estimated_savings,
        reasoning: d.reasoning,
        recommendation: d.recommendation,
        evidence: d.evidence,
        candidateReason: d.candidate_reason || [],
        isQuickWin: d.is_quick_win,
        isS3Candidate: d.is_s3_candidate,
        detectionGap: d.detection_gap,
        governanceStatus: d.gov_status || 'NEW',
        governanceNote: d.gov_note || null,
        governanceActor: d.gov_actor || null,
        governanceUpdatedAt: d.gov_updated_at || null,
      })),
      quickWins: decisions
        .filter((d: any) => d.is_quick_win)
        .sort((a: any, b: any) => (b.estimated_savings || 0) - (a.estimated_savings || 0))
        .slice(0, 5)
        .map((d: any) => ({
          indexName: d.index_name,
          action: d.action,
          savings: d.estimated_savings || 0,
          tier: d.tier || 'CRITICAL',
          reasoning: d.recommendation || '',
        })),
      snapshotDate: publishedRun.publishedAt || publishedRun.startedAt,
      agentReasoning: kpi?.agent_reasoning || '',
    },
    meta: {
      source: 'postgres',
      runId: publishedRun.runId,
      snapshotId: publishedRun.snapshotId,
      publishedAt: publishedRun.publishedAt,
      tenantId,
    },
  };
});
