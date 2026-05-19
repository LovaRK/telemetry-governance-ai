/**
 * FEEDBACK LOOP
 * Closes the agentic cycle: Execute → Observe → Re-score → Update KPIs
 * Without this, the system is analytical (decision-support). With it, it's agentic.
 */

import { getJobProducer } from './job-producer';
import { Topics } from './topics';

/**
 * Feedback events after execution
 */
export interface ExecutionFeedback {
  decisionId: string;
  index: string;
  decision: string;
  executionStatus: 'success' | 'failed';
  actionsCompleted: number;
  actionsFailed: number;
  timestamp: Date;
  changesMade?: {
    retentionDaysChanged?: number;
    indexDeleted?: boolean;
    dataArchived?: boolean;
  };
}

/**
 * Post-execution feedback handler
 */
export async function handleExecutionFeedback(feedback: ExecutionFeedback): Promise<void> {
  console.log(`[FeedbackLoop] Processing execution feedback: ${feedback.decisionId}`);

  const producer = getJobProducer();

  // Step 1: Log execution result
  await producer.logAuditEvent(feedback.decisionId, 'system', 'execution.completed', {
    decision: feedback.decision,
    status: feedback.executionStatus,
    actionsCompleted: feedback.actionsCompleted,
    actionsFailed: feedback.actionsFailed,
  });

  // Step 2: If successful, re-score the index
  if (feedback.executionStatus === 'success') {
    await producer.logAuditEvent(feedback.decisionId, 'system', 'execution.success', {
      index: feedback.index,
      changesMade: feedback.changesMade,
    });

    // Trigger re-ingestion for this index (small re-score)
    await producer.computeScores(feedback.decisionId, 'system');
  } else {
    // If failed, escalate
    await producer.logAuditEvent(feedback.decisionId, 'system', 'execution.failed', {
      index: feedback.index,
      actionsFailed: feedback.actionsFailed,
    });

    // Notify operations team
    await notifyOperations(feedback);
  }
}

/**
 * Re-scoring feedback: index characteristics changed
 */
export async function handleReScoringFeedback(params: {
  snapshotId: string;
  tenantId: string;
  index: string;
  changeType: 'retention_reduced' | 'index_deleted' | 'consolidation' | 'optimized';
  oldComposite?: number;
  newComposite?: number;
}): Promise<void> {
  console.log(`[FeedbackLoop] Re-scoring feedback: ${params.index} (${params.changeType})`);

  const producer = getJobProducer();

  // Log the change
  await producer.logAuditEvent(params.snapshotId, params.tenantId, `rescoring.${params.changeType}`, {
    index: params.index,
    oldComposite: params.oldComposite,
    newComposite: params.newComposite,
  });

  // Trigger re-computation of portfolio KPIs
  // (the new scores will change overall portfolio health)
  await producer.computeKPIs(params.snapshotId, params.tenantId);
}

/**
 * KPI feedback: portfolio changed
 */
export async function handleKPIFeedback(params: {
  snapshotId: string;
  tenantId: string;
  decisionCount: number;
  executedCount: number;
  annualSavings: number;
  newGainScope: number;
  newROIScore: number;
}): Promise<void> {
  console.log(`[FeedbackLoop] KPI update: ${params.decisionCount} decisions, $${params.annualSavings.toFixed(0)} savings`);

  const producer = getJobProducer();

  // Publish KPI update event (this cascades to dashboard)
  await producer.logAuditEvent(params.snapshotId, params.tenantId, 'kpi.updated', {
    decisions: params.decisionCount,
    executed: params.executedCount,
    annualSavings: params.annualSavings,
    gainScope: params.newGainScope,
    roiScore: params.newROIScore,
  });

  // Trigger UI update via SSE
  await emitSSEEvent({
    type: 'KPI_UPDATE',
    tenantId: params.tenantId,
    data: {
      annualSavings: params.annualSavings,
      gainScope: params.newGainScope,
      roiScore: params.newROIScore,
    },
  });
}

/**
 * Emit SSE event for real-time UI update
 */
export async function emitSSEEvent(event: {
  type: string;
  tenantId: string;
  data: any;
}): Promise<void> {
  // This would integrate with your SSE pubsub
  console.log(`[SSE] Emitting: ${event.type} for tenant ${event.tenantId}`);
  // await sseHub.publish(event.tenantId, event);
}

/**
 * Notify operations team (Slack, email, etc.)
 */
export async function notifyOperations(feedback: ExecutionFeedback): Promise<void> {
  console.log(`[Notification] Alerting ops team: ${feedback.decision} failed for ${feedback.index}`);

  // Example: Slack webhook
  // await slack.post({
  //   channel: '#splunk-governance',
  //   message: `⚠️ Execution Failed: ${feedback.decision} on ${feedback.index}`
  // });
}

/**
 * Monthly review feedback
 */
export async function handleMonthlyReview(params: {
  tenantId: string;
  month: string;
  decisionsTotal: number;
  decisionsExecuted: number;
  annualSavingsAchieved: number;
  policiesUpdated: number;
  violationsDetected: number;
}): Promise<void> {
  console.log(`[FeedbackLoop] Monthly review: ${params.month} - ${params.decisionsExecuted}/${params.decisionsTotal} executed`);

  // Generate report, send to stakeholders
  // await reports.generate({
  //   month: params.month,
  //   ...params
  // });
}

/**
 * CLOSED-LOOP ORCHESTRATION
 * This is what makes it agentic
 */

export const FeedbackLoop = {
  /**
   * After execution → closure
   */
  afterExecution: handleExecutionFeedback,

  /**
   * After re-scoring → KPI recalc
   */
  afterReScoring: handleReScoringFeedback,

  /**
   * After KPI update → Dashboard update
   */
  afterKPIUpdate: handleKPIFeedback,

  /**
   * Monthly → Stakeholder report
   */
  monthlyReview: handleMonthlyReview,

  /**
   * Core sequence: Execute → Feedback → Re-score → KPI → UI
   */
  async closeLoop(feedback: ExecutionFeedback): Promise<void> {
    // 1. Handle execution feedback
    await this.afterExecution(feedback);

    // 2. Re-score (if successful)
    if (feedback.executionStatus === 'success') {
      await this.afterReScoring({
        snapshotId: feedback.decisionId,
        tenantId: 'system',
        index: feedback.index,
        changeType: 'optimized',
      });

      // 3. Update KPIs (will trigger UI)
      await this.afterKPIUpdate({
        snapshotId: feedback.decisionId,
        tenantId: 'system',
        decisionCount: 1,
        executedCount: feedback.actionsCompleted,
        annualSavings: 0, // Would be computed from actual changes
        newGainScope: 0,
        newROIScore: 0,
      });
    }
  },
};
