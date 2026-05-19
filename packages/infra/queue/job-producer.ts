/**
 * JOB PRODUCER
 * Typed helpers for publishing jobs to the event bus
 * Ensures correct payload structure for each job type
 */

import { getEventBus } from './event-bus';
import { Topics } from './topics';

/**
 * Typed producer for each pipeline stage
 */
export class JobProducer {
  private bus = getEventBus();

  /**
   * STAGE 1: Trigger ingestion for tenant
   */
  async scheduleIngestion(tenantId: string, snapshotDate: Date = new Date()): Promise<string> {
    console.log(`[Producer] Scheduling ingestion for tenant: ${tenantId}`);

    return this.bus.publish(Topics.INGESTION_SCHEDULED, {
      type: Topics.INGESTION_SCHEDULED,
      tenantId,
      snapshotDate,
    });
  }

  /**
   * STAGE 2: Normalize ingested data
   */
  async normalizeIngestion(
    snapshotId: string,
    tenantId: string,
    rawData: any
  ): Promise<string> {
    console.log(`[Producer] Normalizing ingestion: snapshot=${snapshotId}`);

    return this.bus.publish(Topics.INGESTION_NORMALIZE, {
      type: Topics.INGESTION_NORMALIZE,
      snapshotId,
      tenantId,
      rawData,
    });
  }

  /**
   * STAGE 3: Compute deterministic scores
   */
  async computeScores(snapshotId: string, tenantId: string): Promise<string> {
    console.log(`[Producer] Computing scores: snapshot=${snapshotId}`);

    return this.bus.publish(Topics.SCORING_COMPUTE, {
      type: Topics.SCORING_COMPUTE,
      snapshotId,
      tenantId,
    });
  }

  /**
   * STAGE 4: Validate against policy
   */
  async validatePolicy(
    snapshotId: string,
    tenantId: string,
    policyProfile: string = 'operations_focused'
  ): Promise<string> {
    console.log(`[Producer] Validating policy: snapshot=${snapshotId}, profile=${policyProfile}`);

    return this.bus.publish(Topics.POLICY_VALIDATE, {
      type: Topics.POLICY_VALIDATE,
      snapshotId,
      tenantId,
      policyProfile,
    });
  }

  /**
   * STAGE 5: Run agent reasoning
   */
  async runAgent(snapshotId: string, tenantId: string): Promise<string> {
    console.log(`[Producer] Running agent: snapshot=${snapshotId}`);

    return this.bus.publish(Topics.AGENT_REASONING, {
      type: Topics.AGENT_REASONING,
      snapshotId,
      tenantId,
    });
  }

  /**
   * STAGE 6: Compute KPIs
   */
  async computeKPIs(snapshotId: string, tenantId: string): Promise<string> {
    console.log(`[Producer] Computing KPIs: snapshot=${snapshotId}`);

    return this.bus.publish(Topics.KPI_COMPUTE, {
      type: Topics.KPI_COMPUTE,
      snapshotId,
      tenantId,
    });
  }

  /**
   * LOGGING: Audit trail
   */
  async logAuditEvent(
    snapshotId: string,
    tenantId: string,
    event: string,
    data: any
  ): Promise<string> {
    console.log(`[Producer] Logging audit event: ${event}`);

    return this.bus.publish(Topics.AUDIT_LOG, {
      type: Topics.AUDIT_LOG,
      snapshotId,
      tenantId,
      event,
      data,
    });
  }

  /**
   * WORKFLOW: Request approval
   */
  async requestApproval(decisionId: string, tenantId: string): Promise<string> {
    console.log(`[Producer] Requesting approval: decision=${decisionId}`);

    return this.bus.publish(Topics.WORKFLOW_APPROVE, {
      type: Topics.WORKFLOW_APPROVE,
      decisionId,
      tenantId,
      approver: 'system', // Will be replaced by actual approver
    });
  }

  /**
   * WORKFLOW: Execute approved decision
   */
  async executeDecision(decisionId: string, tenantId: string): Promise<string> {
    console.log(`[Producer] Executing decision: decision=${decisionId}`);

    return this.bus.publish(Topics.WORKFLOW_EXECUTE, {
      type: Topics.WORKFLOW_EXECUTE,
      decisionId,
      tenantId,
    });
  }

  /**
   * FULL PIPELINE: Trigger complete run
   * Publishes initial job; chaining handles rest
   */
  async triggerFullPipeline(
    tenantId: string,
    policyProfile: string = 'operations_focused'
  ): Promise<{
    snapshotId: string;
    ingestionJobId: string;
  }> {
    console.log(`[Producer] Triggering full pipeline for tenant: ${tenantId}`);

    const snapshotId = `snapshot:${tenantId}:${Date.now()}`;

    const ingestionJobId = await this.scheduleIngestion(tenantId);

    // Log pipeline start
    await this.logAuditEvent(snapshotId, tenantId, 'pipeline.started', {
      policyProfile,
      timestamp: new Date(),
    });

    console.log(`[Producer] ✅ Pipeline triggered: ${snapshotId}`);

    return { snapshotId, ingestionJobId };
  }
}

/**
 * Export producer singleton
 */
let producerInstance: JobProducer;

export function getJobProducer(): JobProducer {
  if (!producerInstance) {
    producerInstance = new JobProducer();
  }
  return producerInstance;
}
