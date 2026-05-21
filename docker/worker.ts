/**
 * Background LLM Worker
 *
 * Polls job_queue for pending jobs, processes them with local Ollama.
 * LLM is NEVER called from the HTTP request path — only here.
 *
 * Architecture:
 *   web container  → enqueues job → returns fast
 *   worker (this)  → claims job  → calls Ollama on host → writes decisions → done
 */

import { claimNextJob, updateJobProgress, checkpointJob, setJobComplete, setJobFailed, recoverStaleJobs } from '../apps/api/services/job-service';
import { runLLMDecisionAgent, RawTelemetryInput } from '../apps/api/agents/llm-decision-agent';
import { loadUserConfig } from '../apps/api/services/config-service';
import { pool, query, transaction } from '../core/database/connection';
import { ModelGovernanceService, RuntimeFingerprint } from '../apps/api/services/model-governance-service';
import { appendStageEvent, markRunFailed, publishRunAtomic } from '../apps/api/services/pipeline-ledger-service';

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);
const BATCH_SIZE = 1; // One index at a time — local Ollama memory constraint
const governanceService = new ModelGovernanceService(pool);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processJob(job: any): Promise<void> {
  const { inputs = [], candidateReasons, config, checkpoint = 0 } = job.payload as {
    inputs: RawTelemetryInput[];
    candidateReasons?: Array<{ index: string; sourcetype?: string; reasons: string[] }>;
    config: any;
    checkpoint: number;
  };

  const today = new Date().toISOString().split('T')[0];
  const snapshotId = job.snapshotId || job.payload.snapshotId;
  const runId = (job.payload as any)?.runId || null;
  const tenantId = (job.payload as any)?.tenantId || 'default';
  if (inputs.length === 0) {
    console.log(`[Worker] Job ${job.jobId}: no material AI candidates; publishing Splunk-derived snapshot only`);
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'SUCCESS',
        recordsProcessed: 0,
        metadata: { jobId: job.jobId, snapshotId, mode: 'no_material_candidates' },
      });
      await appendStageEvent({
        runId,
        stage: 'GOVERNANCE_SYNC',
        status: 'SUCCESS',
        metadata: { mode: 'no_material_candidates' },
      });
      await appendStageEvent({ runId, stage: 'PUBLISH', status: 'IN_PROGRESS' });
      await publishRunAtomic({ runId, snapshotId, tenantId });
      await appendStageEvent({ runId, stage: 'PUBLISH', status: 'SUCCESS' });
    }
    await setJobComplete(job.jobId, snapshotId);
    return;
  }

  // Phase 1G-C: Resolve authoritative runtime fingerprint at job boundary.
  // If no active pointer exists, fail fast to avoid ungoverned decisions.
  let runtime: RuntimeFingerprint;
  try {
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'IN_PROGRESS',
        metadata: { jobId: job.jobId, snapshotId },
      });
    }
    runtime = await governanceService.getActiveRuntime();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'FAILED',
        errorType: 'UNKNOWN',
        errorCode: 'NO_ACTIVE_MODEL_POINTER',
        errorMessage: msg,
        metadata: { jobId: job.jobId, snapshotId },
      });
      await markRunFailed(runId, msg);
    }
    throw err;
  }

  // Map candidate reasons for quick lookup
  const reasonsMap = new Map<string, string[]>();
  if (candidateReasons) {
    for (const cr of candidateReasons) {
      const key = cr.sourcetype ? `${cr.index}:${cr.sourcetype}` : cr.index;
      reasonsMap.set(key, cr.reasons);
    }
  }

  console.log(`[Worker] Processing job ${job.jobId}: ${inputs.length} inputs, resuming from checkpoint ${checkpoint}`);

  // Split into batches of 1 (memory-safe for local Ollama)
  const batches: RawTelemetryInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push(inputs.slice(i, i + BATCH_SIZE));
  }

  const userConfig = await loadUserConfig();
  let totalDecisions = 0;
  let failedBatches = 0;

  // Resume from checkpoint (handles worker restart mid-job)
  for (let i = checkpoint; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[Worker] Batch ${i + 1}/${batches.length}: analyzing ${batch.map(b => b.index).join(', ')}`);

    try {
      const batchSummary = await runLLMDecisionAgent(batch, userConfig);
      const decisions = batchSummary.decisions;

      // Write decisions incrementally (partial results appear in dashboard)
      await transaction(async (client) => {
        for (const decision of decisions) {
          const reasonKey = decision.sourcetype ? `${decision.index}:${decision.sourcetype}` : decision.index;
          const candidateReason = reasonsMap.get(reasonKey) || [];
          await writeDecisionToDb(client, decision, snapshotId, today, candidateReason, runtime);
        }
      });

      totalDecisions += decisions.length;

      const progress = {
        batch: i + 1,
        totalBatches: batches.length,
        decisionsWritten: totalDecisions,
        message: `Analyzed ${batch[0]?.index}${batch[0]?.sourcetype ? ':' + batch[0].sourcetype : ''}`,
      };

      // Save checkpoint so we can resume if worker restarts
      await checkpointJob(job.jobId, i + 1, progress);
      await updateJobProgress(job.jobId, progress);

      console.log(`[Worker] Batch ${i + 1}/${batches.length} complete — ${totalDecisions} total decisions written`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Worker] Batch ${i + 1} failed:`, msg);
      failedBatches += 1;
      // Continue to next batch — partial results are still useful
    }
  }

  if (totalDecisions === 0) {
    const failureMessage = failedBatches > 0
      ? `AI_DECISIONS_FAILED: all ${failedBatches} batch(es) failed`
      : 'AI_DECISIONS_FAILED: no decisions produced';
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'FAILED',
        errorType: 'UNKNOWN',
        errorCode: 'AI_DECISIONS_EMPTY',
        errorMessage: failureMessage,
        metadata: { jobId: job.jobId, snapshotId, failedBatches },
      });
      await markRunFailed(runId, failureMessage);
    }
    throw new Error(failureMessage);
  }

  // Final: rebuild executive KPIs from all decisions in DB
  try {
    await rebuildExecutiveKpis(snapshotId, today);
    console.log(`[Worker] Executive KPIs rebuilt for snapshot ${snapshotId}`);
  } catch (err) {
    console.warn('[Worker] KPI rebuild warning:', err instanceof Error ? err.message : err);
  }

  // Populate secondary tables from decisions
  try {
    await populateSecondaryTables(snapshotId, today);
  } catch (err) {
    console.warn('[Worker] Secondary tables warning:', err instanceof Error ? err.message : err);
  }

  if (runId) {
    await appendStageEvent({
      runId,
      stage: 'AI_DECISIONS',
      status: 'SUCCESS',
      recordsProcessed: totalDecisions,
      metadata: {
        jobId: job.jobId,
        snapshotId,
        modelId: runtime.modelId,
        promptId: runtime.promptId,
        promotionId: runtime.promotionId,
        contractVersion: runtime.contractVersion,
      },
    });
    await appendStageEvent({
      runId,
      stage: 'GOVERNANCE_SYNC',
      status: 'SUCCESS',
      metadata: {
        modelId: runtime.modelId,
        promptId: runtime.promptId,
        promotionId: runtime.promotionId,
      },
    });
    await appendStageEvent({ runId, stage: 'PUBLISH', status: 'IN_PROGRESS' });
    try {
      await publishRunAtomic({ runId, snapshotId, tenantId });
      await appendStageEvent({ runId, stage: 'PUBLISH', status: 'SUCCESS' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendStageEvent({
        runId,
        stage: 'PUBLISH',
        status: 'FAILED',
        errorType: 'UNKNOWN',
        errorCode: 'PUBLISH_FAILED',
        errorMessage: msg,
      });
      await markRunFailed(runId, msg);
      throw err;
    }
  }
  await setJobComplete(job.jobId, snapshotId);
  console.log(`[Worker] Job ${job.jobId} complete — ${totalDecisions} decisions written`);
}

async function writeDecisionToDb(
  client: any,
  decision: any,
  snapshotId: string,
  today: string,
  candidateReason: string[] = [],
  runtime?: RuntimeFingerprint
) {
  const confidenceMap: Record<string, number> = { 'HIGH': 0.9, 'MEDIUM': 0.5, 'LOW': 0.3 };
  const classificationMap: Record<string, string> = {
    KEEP: 'KEEP', OPTIMIZE: 'OPTIMIZE', ARCHIVE: 'ARCHIVE',
    ELIMINATE: 'ELIMINATE', S3_CANDIDATE: 'ARCHIVE', INVESTIGATE: 'INVESTIGATE',
  };

  const granularity = decision.sourcetype ? 'sourcetype' : 'index';
  const parentIndex = decision.sourcetype ? decision.index : null;
  const confidence = typeof decision.confidence === 'string'
    ? (confidenceMap[decision.confidence] || 0.5)
    : (Number(decision.confidence) || 0.5);

  // Upsert telemetry_snapshots with LLM scores
  await client.query(`
    UPDATE telemetry_snapshots SET
      risk_score     = $1,
      classification = $2,
      confidence     = $3,
      recommendation = $4,
      evidence       = $5,
      utilization_pct = $6,
      updated_at     = NOW()
    WHERE snapshot_date = $7
      AND index_name = $8
      AND (sourcetype IS NOT DISTINCT FROM $9)
  `, [
    Number(decision.riskScore) || 0,
    classificationMap[decision.action] || 'INVESTIGATE',
    confidence,
    decision.recommendation || '',
    JSON.stringify(decision.evidence || []),
    Number(decision.utilizationScore) || 0,
    today,
    decision.index,
    decision.sourcetype || null,
  ]);

  // Delete existing row first to handle NULL sourcetype (NULLs not matched by ON CONFLICT)
  await client.query(`
    DELETE FROM agent_decisions
    WHERE snapshot_id = $1 AND index_name = $2 AND (sourcetype IS NOT DISTINCT FROM $3)
  `, [snapshotId, decision.index, decision.sourcetype || null]);

  // Insert agent_decisions — idempotent: ON CONFLICT updates in place
  await client.query(`
    INSERT INTO agent_decisions (
      snapshot_id, snapshot_date, index_name, sourcetype,
      tier, action, composite_score, utilization_score, detection_score,
      quality_score, risk_score, annual_license_cost, estimated_savings,
      confidence, confidence_score, recommendation, reasoning, evidence,
      is_quick_win, is_s3_candidate, detection_gap, candidate_reason,
      model_governance_id, prompt_governance_id, promotion_id,
      decision_contract_version, model_version, prompt_version, system_prompt_hash
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
    ON CONFLICT (snapshot_id, index_name, sourcetype) DO UPDATE SET
      tier              = EXCLUDED.tier,
      action            = EXCLUDED.action,
      composite_score   = EXCLUDED.composite_score,
      utilization_score = EXCLUDED.utilization_score,
      detection_score   = EXCLUDED.detection_score,
      quality_score     = EXCLUDED.quality_score,
      risk_score        = EXCLUDED.risk_score,
      estimated_savings = EXCLUDED.estimated_savings,
      confidence        = EXCLUDED.confidence,
      confidence_score  = EXCLUDED.confidence_score,
      recommendation    = EXCLUDED.recommendation,
      reasoning         = EXCLUDED.reasoning,
      evidence          = EXCLUDED.evidence,
      is_quick_win      = EXCLUDED.is_quick_win,
      is_s3_candidate   = EXCLUDED.is_s3_candidate,
      detection_gap     = EXCLUDED.detection_gap,
      candidate_reason  = EXCLUDED.candidate_reason,
      model_governance_id = EXCLUDED.model_governance_id,
      prompt_governance_id = EXCLUDED.prompt_governance_id,
      promotion_id        = EXCLUDED.promotion_id,
      decision_contract_version = EXCLUDED.decision_contract_version,
      model_version       = EXCLUDED.model_version,
      prompt_version      = EXCLUDED.prompt_version,
      system_prompt_hash  = EXCLUDED.system_prompt_hash
  `, [
    snapshotId, today, decision.index, decision.sourcetype || null,
    decision.tier, decision.action,
    Number(decision.compositeScore) || 0,
    Number(decision.utilizationScore) || 0,
    Number(decision.detectionScore) || 0,
    Number(decision.qualityScore) || 0,
    Number(decision.riskScore) || 0,
    Number(decision.annualLicenseCost) || 0,
    Number(decision.estimatedSavings) || 0,
    confidence,
    Number(decision.confidenceScore) || confidence,
    decision.recommendation || '',
    decision.reasoning || '',
    JSON.stringify(decision.evidence || []),
    Boolean(decision.isQuickWin),
    Boolean(decision.isS3Candidate),
    Boolean(decision.detectionGap),
    candidateReason,
    runtime?.modelId || null,
    runtime?.promptId || null,
    runtime?.promotionId || null,
    runtime?.contractVersion || null,
    runtime?.modelVersion || null,
    runtime?.promptVersion || null,
    runtime?.systemPromptHash || null,
  ]);
}

async function rebuildExecutiveKpis(snapshotId: string, today: string) {
  // Aggregate all decisions written so far → update executive_kpis
  const r = await query<any>(`
    SELECT
      COUNT(*) FILTER (WHERE tier ILIKE '%critical%') AS tier_critical,
      COUNT(*) FILTER (WHERE tier ILIKE '%important%') AS tier_important,
      COUNT(*) FILTER (WHERE tier ILIKE '%nice%') AS tier_nice,
      COUNT(*) FILTER (WHERE tier ILIKE '%low%') AS tier_low,
      COUNT(*) FILTER (WHERE detection_gap = true) AS security_gaps,
      ROUND(AVG(utilization_score)::numeric, 1) AS avg_util,
      ROUND(AVG(detection_score)::numeric, 1) AS avg_det,
      ROUND(AVG(quality_score)::numeric, 1) AS avg_qual,
      ROUND(AVG(confidence)::numeric * 100, 1) AS avg_conf,
      SUM(annual_license_cost) AS total_spend,
      SUM(annual_license_cost) FILTER (WHERE tier ILIKE '%low%') AS low_value_spend,
      SUM(estimated_savings) AS savings,
      COUNT(*) FILTER (WHERE is_quick_win = true) AS quick_win_count
    FROM agent_decisions WHERE snapshot_date = $1
  `, [today]);

  const stats = r.rows[0];
  const totalCritical = Number(stats.tier_critical) || 0;
  const totalImportant = Number(stats.tier_important) || 0;
  const totalNice = Number(stats.tier_nice) || 0;
  const totalLow = Number(stats.tier_low) || 0;
  const totalIndexes = totalCritical + totalImportant + totalNice + totalLow;

  // Simple ROI: (savings / total_spend) * 100, capped at 100
  const totalSpend = Number(stats.total_spend) || 1;
  const savings = Number(stats.savings) || 0;
  const roiScore = Math.min(100, Math.round((savings / totalSpend) * 100));
  const gainScopeScore = Math.min(100, Math.round(((totalLow + totalNice) / Math.max(totalIndexes, 1)) * 100));

  await query(`
    UPDATE executive_kpis SET
      roi_score            = $1,
      gainscope_score      = $2,
      tier_critical        = $3,
      tier_important       = $4,
      tier_nice_to_have    = $5,
      tier_low_value       = $6,
      security_gaps        = $7,
      avg_utilization      = $8,
      avg_detection        = $9,
      avg_quality          = $10,
      avg_confidence       = $11,
      license_spend_low_value = $12,
      storage_savings_potential = $13,
      updated_at           = NOW()
    WHERE snapshot_date = $14
  `, [
    roiScore, gainScopeScore,
    totalCritical, totalImportant, totalNice, totalLow,
    Number(stats.security_gaps) || 0,
    Number(stats.avg_util) || 0,
    Number(stats.avg_det) || 0,
    Number(stats.avg_qual) || 0,
    Number(stats.avg_conf) || 0,
    Number(stats.low_value_spend) || 0,
    savings,
    today,
  ]);
}

const MITRE_MAP: Record<string, string[]> = {
  'WinEventLog:Security':    ['T1078', 'T1003', 'T1021', 'T1055'],
  'WinEventLog:System':      ['T1547', 'T1112', 'T1489'],
  'WinEventLog:Application': ['T1059', 'T1036'],
  'pan_traffic':             ['T1071', 'T1572', 'T1008'],
  'cisco_asa':               ['T1190', 'T1078', 'T1133'],
  'cisco_ios':               ['T1110', 'T1046', 'T1040'],
  'linux_secure':            ['T1078', 'T1021', 'T1136'],
  'auditd':                  ['T1055', 'T1003', 'T1059'],
  'aws_cloudtrail':          ['T1078', 'T1530', 'T1537'],
  'o365':                    ['T1078', 'T1114', 'T1566'],
  'syslog':                  ['T1562', 'T1059'],
  'firewall':                ['T1071', 'T1190'],
  'dns':                     ['T1071', 'T1568'],
  'http':                    ['T1071', 'T1566'],
  'netflow':                 ['T1046', 'T1571'],
};

async function populateSecondaryTables(snapshotId: string, today: string) {
  const decisions = await query<any>(`
    SELECT index_name, sourcetype, quality_score, detection_score, detection_gap,
           utilization_score, annual_license_cost, estimated_savings, reasoning, evidence
    FROM agent_decisions WHERE snapshot_date = $1
  `, [today]);

  for (const d of decisions.rows) {
    // Quality hotspots — low quality score items
    if (Number(d.quality_score) < 50) {
      const issueType = extractIssueType(d.evidence);
      await query(`
        INSERT INTO quality_hotspots (snapshot_date, sourcetype, issue_count, quality_score, impact, issue_type, daily_gb)
        VALUES ($1, $2, 1, $3, $4, $5, 0)
      `, [today, d.sourcetype || d.index_name, Number(d.quality_score), Number(d.annual_license_cost), issueType]).catch(() => {});
    }

    // Security coverage — detection gaps
    if (d.detection_gap) {
      const sourceKey = d.sourcetype || '';
      const techniques = MITRE_MAP[sourceKey] || [];
      await query(`
        INSERT INTO security_coverage (snapshot_date, sourcetype, coverage_pct, active_alerts, detection_gaps, mitre_techniques)
        VALUES ($1, $2, $3, 0, 1, $4)
      `, [today, d.sourcetype || d.index_name, Number(d.detection_score), JSON.stringify(techniques)]).catch(() => {});
    }

    // Field usage — estimation from utilization
    await query(`
      INSERT INTO field_usage (snapshot_date, sourcetype, fields_indexed, fields_used, optimization_pct)
      VALUES ($1, $2, 1, 0, $3)
    `, [today, d.sourcetype || d.index_name, Math.round(100 - Number(d.utilization_score))]).catch(() => {});
  }

  console.log(`[Worker] Secondary tables populated for ${decisions.rows.length} decisions`);
}

function extractIssueType(evidence: any): string {
  if (!evidence) return 'Unknown';
  const text = Array.isArray(evidence) ? evidence.join(' ') : String(evidence);
  if (/parse|parsing|error/i.test(text)) return 'DataParseFailure';
  if (/break|event break/i.test(text)) return 'EventBreakIssue';
  if (/format|schema/i.test(text)) return 'SchemaInconsistency';
  if (/duplicate|dup/i.test(text)) return 'DuplicateData';
  return 'QualityDegradation';
}

// ── Main polling loop ──────────────────────────────────────────────────────

async function validateSchemaContract() {
  // Dynamic schema validation — same contract as web service
  const REQUIRED_COLUMNS: { [key: string]: string[] } = {
    telemetry_snapshots: ['snapshot_id', 'snapshot_date', 'created_at'],
    pipeline_runs: ['run_id', 'status', 'published', 'published_at'],
    pipeline_stage_events: ['run_id', 'stage', 'status', 'started_at'],
    agent_decisions: [
      'model_governance_id',
      'prompt_governance_id',
      'promotion_id',
      'decision_contract_version',
      'llm_version',
      'prompt_version',
    ],
    llm_health_cache: ['provider', 'last_checked'],
    prompt_registry: ['prompt_id', 'version', 'encrypted_prompt', 'system_prompt_hash'],
    approved_models: ['model_id', 'model_version', 'status'],
    model_promotions: ['promotion_id', 'runtime_snapshot'],
    active_model_pointer: ['tenant_id', 'model_id', 'prompt_id', 'config_version'],
  };

  const violations: string[] = [];

  // Check tables
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    const res = await query<any>(`
      SELECT 1 FROM information_schema.tables WHERE table_name = $1
    `, [table]);
    if (res.rows.length === 0) {
      violations.push(`Missing table: ${table}`);
    }
  }

  // Check columns
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const col of columns) {
      const res = await query<any>(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
      `, [table, col]);
      if (res.rows.length === 0) {
        violations.push(`Missing column: ${table}.${col}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error('❌ SCHEMA CONTRACT VIOLATION');
    console.error(violations.join('\n'));
    process.exit(1);
  }

  console.log('[Worker] ✓ Schema contract validation passed');
}

async function validateDataPurity() {
  // Allow synthetic data in test/dev environments
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.ALLOW_SYNTHETIC_DATA === 'true' ||
    process.env.NODE_ENV !== 'production'
  ) {
    console.log('[Worker] 🔍 Data purity validation skipped (development mode)');
    return;
  }

  // Reject synthetic data from production database
  console.log('[Worker] 🔍 Validating data purity...');

  const violations: string[] = [];

  // Check for demo tenants
  const demoTenantsRes = await query<any>(`
    SELECT COUNT(*) as count FROM tenants
    WHERE LOWER(slug) ILIKE '%demo%' OR LOWER(name) ILIKE '%demo%'
  `, []);

  if ((demoTenantsRes.rows[0]?.count || 0) > 0) {
    violations.push(`Demo tenant rows: ${demoTenantsRes.rows[0].count}`);
  }

  // Check for synthetic snapshots
  const syntheticRes = await query<any>(`
    SELECT COUNT(*) as count FROM telemetry_snapshots
    WHERE snapshot_id ILIKE '%demo%'
       OR snapshot_id ILIKE '%synthetic%'
  `, []);

  if ((syntheticRes.rows[0]?.count || 0) > 0) {
    violations.push(`Synthetic snapshots: ${syntheticRes.rows[0].count}`);
  }

  // Check for hardcoded KPIs (demo tenant)
  const kpisRes = await query<any>(`
    SELECT COUNT(*) as count FROM executive_kpis
    WHERE tenant_id = 'demo' OR tenant_id ILIKE '%fake%'
  `, []);

  if ((kpisRes.rows[0]?.count || 0) > 0) {
    violations.push(`Hardcoded KPIs: ${kpisRes.rows[0].count}`);
  }

  if (violations.length > 0) {
    console.error('❌ DATA PURITY VIOLATION');
    console.error('Synthetic data detected:', violations.join(', '));
    process.exit(1);
  }

  console.log('[Worker] ✓ Data purity validation passed');
}

async function main() {
  console.log('[Worker] Starting. Polling job_queue every', POLL_INTERVAL_MS, 'ms');
  console.log('[Worker] OLLAMA_BASE_URL:', process.env.OLLAMA_BASE_URL || 'http://localhost:11434');

  // Validate schema contract on startup
  try {
    await validateSchemaContract();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Schema contract validation failed:', msg);
    process.exit(1);
  }

  // Validate data purity on startup
  try {
    await validateDataPurity();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Data purity validation failed:', msg);
    process.exit(1);
  }

  // Recover stale jobs from previous crashed/restarted worker sessions.
  try {
    const recovered = await recoverStaleJobs(parseInt(process.env.WORKER_STALE_JOB_MINUTES || '5', 10));
    if (recovered > 0) {
      console.warn(`[Worker] Recovered ${recovered} stale running/partial job(s) as failed`);
    }
    const staleRuns = await query<any>(`
      UPDATE pipeline_runs
      SET status = 'FAILED',
          published = false,
          error_message = COALESCE(error_message, 'Recovered stale running run after worker restart'),
          idempotency_hash = NULL
      WHERE status = 'RUNNING'
        AND started_at < NOW() - (COALESCE($1::text, '5') || ' minutes')::interval
      RETURNING run_id
    `, [process.env.WORKER_STALE_RUN_MINUTES || '5']);
    if ((staleRuns.rows || []).length > 0) {
      console.warn(`[Worker] Recovered ${staleRuns.rows.length} stale running pipeline run(s) as failed`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Worker] Stale job recovery skipped due to error:', msg);
  }

  while (true) {
    try {
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`[Worker] Claimed job ${job.jobId} (type: ${job.jobType})`);
      try {
        await processJob(job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await setJobFailed(job.jobId, msg);
        throw err;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Worker] Unhandled error in poll loop:', msg);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch(err => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});

const shutdown = async () => {
  try {
    await governanceService.shutdown();
  } catch (e) {
    console.error('[Worker] Governance shutdown warning:', e);
  }
};

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
