import { PoolClient } from 'pg';
import * as crypto from 'crypto';

export type PromptChangeType =
  | 'TYPO_FIX'
  | 'FORMATTING'
  | 'EXAMPLE_UPDATE'
  | 'SCORING_ADJUSTMENT'
  | 'REASONING_RUBRIC'
  | 'GOVERNANCE_POLICY'
  | 'SYSTEM_PROMPT'
  | 'ROLLBACK';

export type FindingType = 'HALLUCINATION' | 'FALSE_POSITIVE' | 'CORRECT_BUT_UNCERTAIN';

export interface PromptVersionPolicy {
  policyId: string;
  promptHash: string;
  versionString: string;
  modelVersion: string;
  changeType: PromptChangeType;
  isBreakingChange: boolean;
  requiresReanalysis: boolean;
  forcesFullReanalysis: boolean;
  confidenceResetFactor: number;
  confidenceResetRequired: boolean;
  isDeprecated: boolean;
  deprecatedAt?: Date;
  replacementPromptHash?: string;
  changelogEntry?: string;
  changeRationale?: string;
  approvedBy?: string;
  approvedAt?: Date;
  createdAt: Date;
}

export interface PromptDeploymentRecord {
  deploymentId: string;
  promptHash: string;
  versionString: string;
  deployedBy: string;
  deployedAt: Date;
  environment: 'staging' | 'production';
  triggeredReanalysisCount: number;
  reanalysisJobsQueuedAt?: Date;
  reanalysisBudgetAllocated?: number;
  decisionsUsingVersion: number;
  avgConfidenceChange?: number;
  approvalRateChangePct?: number;
  criticalErrorsDetected: number;
  rollbackTriggered: boolean;
  rollbackAt?: Date;
}

export interface GroundTruthSamplingSchedule {
  samplingId: string;
  samplingWeekStart: Date;
  samplingWeekEnd: Date;
  totalStableDecisionsAvailable: number;
  sampleSize5pct: number;
  samplingStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  samplingInitiatedAt?: Date;
  samplingCompletedAt?: Date;
  decisionsReviewed: number;
  hallucinationsDetected: number;
  falsePositivesFound: number;
  accuracyRatePct?: number;
}

export interface GroundTruthFinding {
  findingId: string;
  samplingId: string;
  indexName: string;
  decisionId: string;
  findingType: FindingType;
  findingDescription: string;
  confidenceWasHigh: boolean;
  approvalStatusBeforeFinding?: string;
  remediationAction?: string;
  remediationTriggeredReanalysis: boolean;
  reviewedBy?: string;
  reviewedAt?: Date;
  expertConclusion?: string;
}

// Change type classification matrix
const CHANGE_CLASSIFICATION: Record<
  PromptChangeType,
  {
    requiresReanalysis: boolean;
    forcesFullReanalysis: boolean;
    confidenceResetFactor: number;
    queuePriority: string;
    description: string;
  }
> = {
  TYPO_FIX: {
    requiresReanalysis: false,
    forcesFullReanalysis: false,
    confidenceResetFactor: 1.0,
    queuePriority: 'DEFERRED',
    description: 'Grammar/spelling fix only',
  },
  FORMATTING: {
    requiresReanalysis: false,
    forcesFullReanalysis: false,
    confidenceResetFactor: 1.0,
    queuePriority: 'DEFERRED',
    description: 'Whitespace or template restructure',
  },
  EXAMPLE_UPDATE: {
    requiresReanalysis: false,
    forcesFullReanalysis: false,
    confidenceResetFactor: 0.95,
    queuePriority: 'BACKGROUND',
    description: 'Updated examples but not scoring logic',
  },
  SCORING_ADJUSTMENT: {
    requiresReanalysis: true,
    forcesFullReanalysis: false,
    confidenceResetFactor: 0.85,
    queuePriority: 'STANDARD',
    description: 'Modified confidence or score calculation',
  },
  REASONING_RUBRIC: {
    requiresReanalysis: true,
    forcesFullReanalysis: false,
    confidenceResetFactor: 0.75,
    queuePriority: 'STANDARD',
    description: 'Changed decision rationale or classification rules',
  },
  GOVERNANCE_POLICY: {
    requiresReanalysis: true,
    forcesFullReanalysis: true,
    confidenceResetFactor: 0.5,
    queuePriority: 'CRITICAL',
    description: 'New compliance/governance constraint',
  },
  SYSTEM_PROMPT: {
    requiresReanalysis: true,
    forcesFullReanalysis: true,
    confidenceResetFactor: 0.25,
    queuePriority: 'EMERGENCY',
    description: 'Core reasoning paradigm changed',
  },
  ROLLBACK: {
    requiresReanalysis: true,
    forcesFullReanalysis: false,
    confidenceResetFactor: 1.0,
    queuePriority: 'CRITICAL',
    description: 'Reverting to previous prompt version',
  },
};

/**
 * Register a new prompt version with semantic classification
 */
export async function registerPromptVersion(
  client: PoolClient,
  promptText: string,
  versionString: string,
  modelVersion: string,
  changeType: PromptChangeType,
  options?: {
    changelogEntry?: string;
    changeRationale?: string;
    approvedBy?: string;
  }
): Promise<PromptVersionPolicy> {
  const promptHash = computePromptHash(promptText);
  const classification = CHANGE_CLASSIFICATION[changeType];

  const result = await client.query(
    `INSERT INTO prompt_version_policy (
      prompt_hash, version_string, model_version,
      change_type, is_breaking_change,
      requires_reanalysis, forces_full_reanalysis,
      confidence_reset_factor, confidence_reset_required,
      changelog_entry, change_rationale, approved_by, approved_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    [
      promptHash,
      versionString,
      modelVersion,
      changeType,
      classification.forcesFullReanalysis,
      classification.requiresReanalysis,
      classification.forcesFullReanalysis,
      classification.confidenceResetFactor,
      classification.requiresReanalysis,
      options?.changelogEntry || null,
      options?.changeRationale || null,
      options?.approvedBy || null,
      options?.approvedBy ? new Date() : null,
    ]
  );

  return parseVersionPolicy(result.rows[0]);
}

/**
 * Deploy a prompt version to an environment
 */
export async function deployPromptVersion(
  client: PoolClient,
  promptHash: string,
  versionString: string,
  deployedBy: string,
  environment: 'staging' | 'production'
): Promise<{ deployment: PromptDeploymentRecord; reanalysisTriggered: boolean }> {
  // Get version policy
  const policyResult = await client.query(
    `SELECT * FROM prompt_version_policy WHERE prompt_hash = $1`,
    [promptHash]
  );

  if (policyResult.rows.length === 0) {
    throw new Error(`Prompt version not found: ${promptHash}`);
  }

  const policy = parseVersionPolicy(policyResult.rows[0]);

  // Get deployment count to track decisions using this version
  const countResult = await client.query(
    `SELECT COUNT(*) as count FROM agent_decisions WHERE prompt_version = $1`,
    [versionString]
  );

  const decisionsUsingVersion = countResult.rows[0].count;

  // Create deployment record
  const deploymentResult = await client.query(
    `INSERT INTO prompt_deployment_ledger (
      prompt_hash, version_string,
      deployed_by, environment,
      triggered_reanalysis_count,
      decisions_using_version
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      promptHash,
      versionString,
      deployedBy,
      environment,
      policy.forcesFullReanalysis ? decisionsUsingVersion : 0,
      decisionsUsingVersion,
    ]
  );

  const deployment = parseDeployment(deploymentResult.rows[0]);

  return {
    deployment,
    reanalysisTriggered: policy.requiresReanalysis,
  };
}

/**
 * Create ground truth sampling schedule (weekly 5% sample)
 */
export async function scheduleGroundTruthSampling(
  client: PoolClient,
  weekStart: Date,
  weekEnd: Date
): Promise<GroundTruthSamplingSchedule> {
  // Get count of stable decisions
  const stableResult = await client.query(
    `SELECT COUNT(*) as count FROM agent_decisions
     WHERE approval_status = 'APPROVED'
     AND drift_detected = FALSE
     AND created_at >= $1 AND created_at <= $2`,
    [weekStart, weekEnd]
  );

  const totalStable = stableResult.rows[0].count;
  const sampleSize = Math.ceil(totalStable * 0.05); // 5% sample

  const result = await client.query(
    `INSERT INTO ground_truth_sampling_schedule (
      sampling_week_start, sampling_week_end,
      total_stable_decisions_available, sample_size_5pct,
      sampling_status
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [weekStart, weekEnd, totalStable, sampleSize, 'PENDING']
  );

  return parseSamplingSchedule(result.rows[0]);
}

/**
 * Record a ground truth finding (hallucination detection)
 */
export async function recordGroundTruthFinding(
  client: PoolClient,
  samplingId: string,
  indexName: string,
  decisionId: string,
  findingType: FindingType,
  findingDescription: string,
  confidenceWasHigh: boolean,
  options?: {
    approvalStatusBefore?: string;
    remediationAction?: string;
    remediationTriggeredReanalysis?: boolean;
  }
): Promise<GroundTruthFinding> {
  const result = await client.query(
    `INSERT INTO ground_truth_findings (
      sampling_id, index_name, decision_id,
      finding_type, finding_description,
      confidence_was_high, approval_status_before_finding,
      remediation_action, remediation_triggered_reanalysis
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      samplingId,
      indexName,
      decisionId,
      findingType,
      findingDescription,
      confidenceWasHigh,
      options?.approvalStatusBefore || null,
      options?.remediationAction || null,
      options?.remediationTriggeredReanalysis || false,
    ]
  );

  return parseGroundTruthFinding(result.rows[0]);
}

/**
 * Complete ground truth sampling and record results
 */
export async function completeSampling(
  client: PoolClient,
  samplingId: string,
  decisionsReviewed: number,
  hallucinationsDetected: number,
  falsePositivesFound: number
): Promise<GroundTruthSamplingSchedule> {
  const accuracyRate = decisionsReviewed > 0
    ? ((decisionsReviewed - hallucinationsDetected - falsePositivesFound) / decisionsReviewed) * 100
    : 0;

  const result = await client.query(
    `UPDATE ground_truth_sampling_schedule SET
      sampling_status = 'COMPLETED',
      sampling_completed_at = NOW(),
      decisions_reviewed = $1,
      hallucinations_detected = $2,
      false_positives_found = $3,
      accuracy_rate_pct = $4
    WHERE sampling_id = $5
    RETURNING *`,
    [decisionsReviewed, hallucinationsDetected, falsePositivesFound, accuracyRate, samplingId]
  );

  return parseSamplingSchedule(result.rows[0]);
}

/**
 * Get next sampling to execute
 */
export async function getNextSamplingToExecute(
  client: PoolClient
): Promise<GroundTruthSamplingSchedule | null> {
  const result = await client.query(
    `SELECT * FROM ground_truth_sampling_schedule
     WHERE sampling_status = 'PENDING'
     ORDER BY sampling_week_start ASC
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  return parseSamplingSchedule(result.rows[0]);
}

/**
 * Get findings from a sampling
 */
export async function getSamplingFindings(
  client: PoolClient,
  samplingId: string,
  filterType?: FindingType
): Promise<GroundTruthFinding[]> {
  const whereClause = filterType ? 'AND finding_type = $2' : '';
  const params = filterType ? [samplingId, filterType] : [samplingId];

  const result = await client.query(
    `SELECT * FROM ground_truth_findings
     WHERE sampling_id = $1 ${whereClause}
     ORDER BY created_at DESC`,
    params
  );

  return result.rows.map(parseGroundTruthFinding);
}

/**
 * Get change classification for a change type
 */
export function getChangeClassification(changeType: PromptChangeType): typeof CHANGE_CLASSIFICATION[keyof typeof CHANGE_CLASSIFICATION] {
  return CHANGE_CLASSIFICATION[changeType];
}

/**
 * Compute SHA256 hash of prompt text
 */
export function computePromptHash(promptText: string): string {
  return crypto.createHash('sha256').update(promptText).digest('hex');
}

/**
 * Check if prompt version requires reanalysis
 */
export async function doesVersionRequireReanalysis(
  client: PoolClient,
  promptHash: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT requires_reanalysis FROM prompt_version_policy WHERE prompt_hash = $1`,
    [promptHash]
  );

  if (result.rows.length === 0) {
    return false;
  }

  return result.rows[0].requires_reanalysis;
}

/**
 * Check if prompt version forces full reanalysis
 */
export async function doesVersionForceFullReanalysis(
  client: PoolClient,
  promptHash: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT forces_full_reanalysis FROM prompt_version_policy WHERE prompt_hash = $1`,
    [promptHash]
  );

  if (result.rows.length === 0) {
    return false;
  }

  return result.rows[0].forces_full_reanalysis;
}

/**
 * Get confidence reset factor for a version
 */
export async function getConfidenceResetFactor(
  client: PoolClient,
  promptHash: string
): Promise<number> {
  const result = await client.query(
    `SELECT confidence_reset_factor FROM prompt_version_policy WHERE prompt_hash = $1`,
    [promptHash]
  );

  if (result.rows.length === 0) {
    return 1.0; // No reset
  }

  return parseFloat(result.rows[0].confidence_reset_factor);
}

/**
 * Parse database row into PromptVersionPolicy
 */
function parseVersionPolicy(row: any): PromptVersionPolicy {
  return {
    policyId: row.policy_id,
    promptHash: row.prompt_hash,
    versionString: row.version_string,
    modelVersion: row.model_version,
    changeType: row.change_type,
    isBreakingChange: row.is_breaking_change,
    requiresReanalysis: row.requires_reanalysis,
    forcesFullReanalysis: row.forces_full_reanalysis,
    confidenceResetFactor: parseFloat(row.confidence_reset_factor),
    confidenceResetRequired: row.confidence_reset_required,
    isDeprecated: row.is_deprecated,
    deprecatedAt: row.deprecated_at ? new Date(row.deprecated_at) : undefined,
    replacementPromptHash: row.replacement_prompt_hash,
    changelogEntry: row.changelog_entry,
    changeRationale: row.change_rationale,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Parse database row into PromptDeploymentRecord
 */
function parseDeployment(row: any): PromptDeploymentRecord {
  return {
    deploymentId: row.deployment_id,
    promptHash: row.prompt_hash,
    versionString: row.version_string,
    deployedBy: row.deployed_by,
    deployedAt: new Date(row.deployed_at),
    environment: row.environment,
    triggeredReanalysisCount: row.triggered_reanalysis_count,
    reanalysisJobsQueuedAt: row.reanalysis_jobs_queued_at ? new Date(row.reanalysis_jobs_queued_at) : undefined,
    reanalysisBudgetAllocated: row.reanalysis_budget_allocated,
    decisionsUsingVersion: row.decisions_using_version,
    avgConfidenceChange: row.avg_confidence_change ? parseFloat(row.avg_confidence_change) : undefined,
    approvalRateChangePct: row.approval_rate_change_pct ? parseFloat(row.approval_rate_change_pct) : undefined,
    criticalErrorsDetected: row.critical_errors_detected,
    rollbackTriggered: row.rollback_triggered,
    rollbackAt: row.rollback_at ? new Date(row.rollback_at) : undefined,
  };
}

/**
 * Parse database row into GroundTruthSamplingSchedule
 */
function parseSamplingSchedule(row: any): GroundTruthSamplingSchedule {
  return {
    samplingId: row.sampling_id,
    samplingWeekStart: new Date(row.sampling_week_start),
    samplingWeekEnd: new Date(row.sampling_week_end),
    totalStableDecisionsAvailable: row.total_stable_decisions_available,
    sampleSize5pct: row.sample_size_5pct,
    samplingStatus: row.sampling_status,
    samplingInitiatedAt: row.sampling_initiated_at ? new Date(row.sampling_initiated_at) : undefined,
    samplingCompletedAt: row.sampling_completed_at ? new Date(row.sampling_completed_at) : undefined,
    decisionsReviewed: row.decisions_reviewed,
    hallucinationsDetected: row.hallucinations_detected,
    falsePositivesFound: row.false_positives_found,
    accuracyRatePct: row.accuracy_rate_pct ? parseFloat(row.accuracy_rate_pct) : undefined,
  };
}

/**
 * Parse database row into GroundTruthFinding
 */
function parseGroundTruthFinding(row: any): GroundTruthFinding {
  return {
    findingId: row.finding_id,
    samplingId: row.sampling_id,
    indexName: row.index_name,
    decisionId: row.decision_id,
    findingType: row.finding_type,
    findingDescription: row.finding_description,
    confidenceWasHigh: row.confidence_was_high,
    approvalStatusBeforeFinding: row.approval_status_before_finding,
    remediationAction: row.remediation_action,
    remediationTriggeredReanalysis: row.remediation_triggered_reanalysis,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
    expertConclusion: row.expert_conclusion,
  };
}
