export type SnapshotStatus = 'NOT_READY' | 'READY' | 'FAILED';

export type LLMStatus =
  | 'NOT_STARTED'
  | 'RUNNING'
  | 'READY'
  | 'FAILED'
  | 'FAILED_TIMEOUT';

export type PipelineStatus = 'PENDING' | 'PARTIAL' | 'READY' | 'FAILED';

export interface PipelineLifecycleState {
  requestId: string;
  runId: string;
  tenantId: string;
  snapshotStatus: SnapshotStatus;
  llmStatus: LLMStatus;
  pipelineStatus: PipelineStatus;
  failureCode?:
    | 'MISSING_DECISIONS'
    | 'TIMEOUT'
    | 'RUNTIME'
    | 'FAILED_MODEL_UNAVAILABLE'
    | 'FAILED_MODEL_TIMEOUT'
    | 'FAILED_MODEL_REFUSED'
    | 'FAILED_MODEL_CONTEXT'
    | 'FAILED_MODEL_CRASH'
    | null;
  failureReason?: string | null;
  updatedAt?: string;
  lastRunAt?: string | null;
  lastDecisionAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export const PIPELINE_IDLE_TIMEOUT_MS = Number(process.env.PIPELINE_IDLE_TIMEOUT_MS || 5 * 60 * 1000);

/**
 * Canonical lifecycle derivation rule.
 * READY = snapshot READY AND llm READY.
 */
export function derivePipelineStatus(
  snapshotStatus: SnapshotStatus,
  llmStatus: LLMStatus
): PipelineStatus {
  if (snapshotStatus === 'FAILED') return 'FAILED';
  if (snapshotStatus === 'READY' && llmStatus === 'READY') return 'READY';
  if (snapshotStatus === 'READY' && llmStatus !== 'READY') return 'PARTIAL';
  return 'PENDING';
}

export function normalizeLifecycle(input: {
  snapshotStatus: SnapshotStatus;
  llmStatus: LLMStatus;
  aiDecisionStage: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | null;
  aiDecisionMode?: string | null;
  decisionCount: number;
  lastStageAt?: string | null;
  runId?: string | null;
  previousFailureCode?:
    | 'MISSING_DECISIONS'
    | 'TIMEOUT'
    | 'RUNTIME'
    | 'FAILED_MODEL_UNAVAILABLE'
    | 'FAILED_MODEL_TIMEOUT'
    | 'FAILED_MODEL_REFUSED'
    | 'FAILED_MODEL_CONTEXT'
    | 'FAILED_MODEL_CRASH'
    | null;
  previousFailureRunId?: string | null;
}): { llmStatus: LLMStatus; pipelineStatus: PipelineStatus; failureCode: PipelineLifecycleState['failureCode']; failureReason: string | null } {
  // 1) Resurrection guard: same run_id stays failed until a new run starts.
  if (
    input.runId &&
    input.previousFailureRunId &&
    input.runId === input.previousFailureRunId &&
    (input.previousFailureCode === 'TIMEOUT' || input.previousFailureCode === 'MISSING_DECISIONS')
  ) {
    return {
      llmStatus: input.previousFailureCode === 'TIMEOUT' ? 'FAILED_TIMEOUT' : 'FAILED',
      pipelineStatus: 'FAILED',
      failureCode: input.previousFailureCode,
      failureReason:
        input.previousFailureCode === 'TIMEOUT'
          ? 'Pipeline run exceeded idle timeout and remains failed until a new run starts'
          : 'AI_DECISIONS marked SUCCESS but no persisted decisions found',
    };
  }

  // 2) Invariant: AI_DECISIONS cannot be SUCCESS with zero persisted decisions.
  if (
    input.aiDecisionStage === 'SUCCESS' &&
    input.llmStatus === 'READY' &&
    input.decisionCount === 0 &&
    input.aiDecisionMode !== 'no_material_candidates'
  ) {
    return {
      llmStatus: 'FAILED',
      pipelineStatus: 'FAILED',
      failureCode: 'MISSING_DECISIONS',
      failureReason: 'AI_DECISIONS marked SUCCESS but no persisted decisions found',
    };
  }

  // 3) Timeout normalization: RUNNING with stale stage updates is a failed timeout.
  if (input.llmStatus === 'RUNNING' && input.lastStageAt) {
    const lastStageTs = new Date(input.lastStageAt).getTime();
    if (Number.isFinite(lastStageTs) && Date.now() - lastStageTs > PIPELINE_IDLE_TIMEOUT_MS) {
      return {
        llmStatus: 'FAILED_TIMEOUT',
        pipelineStatus: 'FAILED',
        failureCode: 'TIMEOUT',
        failureReason: 'Pipeline idle timeout exceeded while AI decisions were running',
      };
    }
  }

  // 4) Canonical fallback.
  return {
    llmStatus: input.llmStatus,
    pipelineStatus: derivePipelineStatus(input.snapshotStatus, input.llmStatus),
    failureCode: null,
    failureReason: null,
  };
}
