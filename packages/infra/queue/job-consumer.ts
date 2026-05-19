/**
 * JOB CONSUMER
 * Worker handlers for each pipeline stage
 * Each handler is idempotent and stateless
 */

import { getEventBus } from './event-bus';
import { getJobProducer } from './job-producer';
import { Topics, JobPayload } from './topics';

/**
 * WORKER HANDLERS
 * Each stage in the pipeline as an isolated, retryable function
 */

/**
 * INGESTION SCHEDULED: Fetch raw Splunk data
 */
export async function handleIngestionScheduled(payload: Extract<JobPayload, { type: Topics.INGESTION_SCHEDULED }>) {
  console.log(`[Worker:INGESTION_SCHEDULED] Processing for tenant: ${payload.tenantId}`);

  try {
    // Fetch from Splunk API (idempotent by snapshotDate)
    const rawData = await fetchRawSplunkData(payload.tenantId, payload.snapshotDate);

    const snapshotId = `snapshot:${payload.tenantId}:${Date.now()}`;

    // Publish next stage
    const producer = getJobProducer();
    await producer.normalizeIngestion(snapshotId, payload.tenantId, rawData);

    console.log(`[Worker:INGESTION_SCHEDULED] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:INGESTION_SCHEDULED] ❌ Error:`, err);
    throw err; // Trigger retry
  }
}

/**
 * INGESTION NORMALIZE: Convert raw → gold layer
 */
export async function handleIngestionNormalize(payload: Extract<JobPayload, { type: Topics.INGESTION_NORMALIZE }>) {
  console.log(`[Worker:INGESTION_NORMALIZE] Processing snapshot: ${payload.snapshotId}`);

  try {
    // Normalize using gold layer
    const { normalizeGoldLayer } = await import('@infra/aggregation/gold-engine-adapter');
    const goldData = await normalizeGoldLayer(payload.rawData);

    // Store in DB (idempotent by snapshotId)
    await storeNormalizedData(payload.snapshotId, payload.tenantId, goldData);

    // Publish next stage
    const producer = getJobProducer();
    await producer.computeScores(payload.snapshotId, payload.tenantId);

    console.log(`[Worker:INGESTION_NORMALIZE] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:INGESTION_NORMALIZE] ❌ Error:`, err);
    throw err;
  }
}

/**
 * SCORING COMPUTE: Run deterministic engine
 */
export async function handleScoringCompute(payload: Extract<JobPayload, { type: Topics.SCORING_COMPUTE }>) {
  console.log(`[Worker:SCORING_COMPUTE] Processing snapshot: ${payload.snapshotId}`);

  try {
    // Retrieve normalized data
    const goldData = await retrieveNormalizedData(payload.snapshotId, payload.tenantId);

    // Score using engine
    const { scoreWithEngine } = await import('@infra/aggregation/gold-engine-adapter');
    const scored = await scoreWithEngine(goldData);

    // Store results (idempotent by snapshotId)
    await storeScores(payload.snapshotId, payload.tenantId, scored);

    // Publish next stage
    const producer = getJobProducer();
    await producer.validatePolicy(payload.snapshotId, payload.tenantId);

    console.log(`[Worker:SCORING_COMPUTE] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:SCORING_COMPUTE] ❌ Error:`, err);
    throw err;
  }
}

/**
 * POLICY VALIDATE: Run policy engine
 */
export async function handlePolicyValidate(payload: Extract<JobPayload, { type: Topics.POLICY_VALIDATE }>) {
  console.log(`[Worker:POLICY_VALIDATE] Processing snapshot: ${payload.snapshotId}`);

  try {
    // Retrieve scores
    const scored = await retrieveScores(payload.snapshotId, payload.tenantId);

    // Validate with policy
    const { runPolicyValidationPipeline } = await import('@infra/aggregation/policy-engine-adapter');
    const recommendations = await generateLLMRecommendations(scored); // Placeholder

    const pipelineResult = await runPolicyValidationPipeline(
      scored,
      recommendations,
      payload.policyProfile
    );

    // Store validations (idempotent by snapshotId)
    await storeValidations(payload.snapshotId, payload.tenantId, pipelineResult);

    // Publish next stage
    const producer = getJobProducer();
    await producer.runAgent(payload.snapshotId, payload.tenantId);

    console.log(`[Worker:POLICY_VALIDATE] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:POLICY_VALIDATE] ❌ Error:`, err);
    throw err;
  }
}

/**
 * AGENT REASONING: Run LLM decision agent
 */
export async function handleAgentReasoning(payload: Extract<JobPayload, { type: Topics.AGENT_REASONING }>) {
  console.log(`[Worker:AGENT_REASONING] Processing snapshot: ${payload.snapshotId}`);

  try {
    // Retrieve validated decisions + policy context
    const validations = await retrieveValidations(payload.snapshotId, payload.tenantId);

    // Run LLM with policy context (CRITICAL: policy comes first)
    const decisions = await runLLMDecisionAgent(validations);

    // Store decisions (idempotent by snapshotId)
    await storeDecisions(payload.snapshotId, payload.tenantId, decisions);

    // Publish next stage
    const producer = getJobProducer();
    await producer.computeKPIs(payload.snapshotId, payload.tenantId);

    console.log(`[Worker:AGENT_REASONING] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:AGENT_REASONING] ❌ Error:`, err);
    throw err;
  }
}

/**
 * KPI COMPUTE: Calculate portfolio metrics
 */
export async function handleKPICompute(payload: Extract<JobPayload, { type: Topics.KPI_COMPUTE }>) {
  console.log(`[Worker:KPI_COMPUTE] Processing snapshot: ${payload.snapshotId}`);

  try {
    // Retrieve all data
    const scored = await retrieveScores(payload.snapshotId, payload.tenantId);
    const decisions = await retrieveDecisions(payload.snapshotId, payload.tenantId);

    // Compute KPIs
    const kpis = computePortfolioKPIs(scored, decisions);

    // Store KPIs (idempotent by snapshotId)
    await storeKPIs(payload.snapshotId, payload.tenantId, kpis);

    // Log completion
    const producer = getJobProducer();
    await producer.logAuditEvent(payload.snapshotId, payload.tenantId, 'pipeline.completed', {
      kpis,
      timestamp: new Date(),
    });

    console.log(`[Worker:KPI_COMPUTE] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:KPI_COMPUTE] ❌ Error:`, err);
    throw err;
  }
}

/**
 * AUDIT LOG: Persist audit trail
 */
export async function handleAuditLog(payload: Extract<JobPayload, { type: Topics.AUDIT_LOG }>) {
  console.log(`[Worker:AUDIT_LOG] Logging event: ${payload.event}`);

  try {
    // Idempotent: use (snapshotId, event) as key
    await persistAuditEvent(payload.snapshotId || 'system', payload.tenantId, payload.event, payload.data);
    console.log(`[Worker:AUDIT_LOG] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:AUDIT_LOG] ❌ Error (non-blocking):`, err);
    // Don't throw — audit logging failures shouldn't block pipeline
  }
}

/**
 * WORKFLOW APPROVE: Wait for approval
 */
export async function handleWorkflowApprove(payload: Extract<JobPayload, { type: Topics.WORKFLOW_APPROVE }>) {
  console.log(`[Worker:WORKFLOW_APPROVE] Awaiting approval: ${payload.decisionId}`);

  try {
    // Wait for approval (this would integrate with a UI workflow)
    const approved = await waitForApproval(payload.decisionId, payload.tenantId);

    if (approved) {
      const producer = getJobProducer();
      const tenantId = payload.tenantId;
      await producer.executeDecision(payload.decisionId, tenantId);
    }

    console.log(`[Worker:WORKFLOW_APPROVE] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:WORKFLOW_APPROVE] ❌ Error:`, err);
    throw err;
  }
}

/**
 * WORKFLOW EXECUTE: Execute approved decisions
 */
export async function handleWorkflowExecute(payload: Extract<JobPayload, { type: Topics.WORKFLOW_EXECUTE }>) {
  console.log(`[Worker:WORKFLOW_EXECUTE] Executing decision: ${payload.decisionId}`);

  try {
    const decision = await retrieveApprovedDecision(payload.decisionId, payload.tenantId);

    // Execute (e.g., call Splunk API, trigger Jira, etc.)
    await executeGovernanceDecision(decision);

    console.log(`[Worker:WORKFLOW_EXECUTE] ✅ Complete`);
  } catch (err) {
    console.error(`[Worker:WORKFLOW_EXECUTE] ❌ Error:`, err);
    throw err;
  }
}

/**
 * PLACEHOLDER FUNCTIONS (implemented by consumer integration)
 */
async function fetchRawSplunkData(tenantId: string, snapshotDate: Date): Promise<any> {
  console.log(`[Stub] Fetching Splunk data for ${tenantId}`);
  return { savedSearches: [], dashboards: [], indexMetrics: [] };
}

async function storeNormalizedData(snapshotId: string, tenantId: string, goldData: any): Promise<void> {
  console.log(`[Stub] Storing normalized data: ${snapshotId}`);
}

async function retrieveNormalizedData(snapshotId: string, tenantId: string): Promise<any> {
  console.log(`[Stub] Retrieving normalized data: ${snapshotId}`);
  return { telemetry: [], detection: new Map(), quality: new Map(), searches: [], dashboards: [] };
}

async function storeScores(snapshotId: string, tenantId: string, scored: any[]): Promise<void> {
  console.log(`[Stub] Storing scores: ${snapshotId}`);
}

async function retrieveScores(snapshotId: string, tenantId: string): Promise<any[]> {
  console.log(`[Stub] Retrieving scores: ${snapshotId}`);
  return [];
}

async function storeValidations(snapshotId: string, tenantId: string, validations: any): Promise<void> {
  console.log(`[Stub] Storing validations: ${snapshotId}`);
}

async function retrieveValidations(snapshotId: string, tenantId: string): Promise<any> {
  console.log(`[Stub] Retrieving validations: ${snapshotId}`);
  return [];
}

async function generateLLMRecommendations(scored: any[]): Promise<any[]> {
  console.log(`[Stub] Generating LLM recommendations`);
  return [];
}

async function runLLMDecisionAgent(validations: any): Promise<any[]> {
  console.log(`[Stub] Running LLM decision agent`);
  return [];
}

async function storeDecisions(snapshotId: string, tenantId: string, decisions: any[]): Promise<void> {
  console.log(`[Stub] Storing decisions: ${snapshotId}`);
}

async function retrieveDecisions(snapshotId: string, tenantId: string): Promise<any[]> {
  console.log(`[Stub] Retrieving decisions: ${snapshotId}`);
  return [];
}

function computePortfolioKPIs(scored: any[], decisions: any[]): any {
  console.log(`[Stub] Computing portfolio KPIs`);
  return {};
}

async function storeKPIs(snapshotId: string, tenantId: string, kpis: any): Promise<void> {
  console.log(`[Stub] Storing KPIs: ${snapshotId}`);
}

async function persistAuditEvent(snapshotId: string, tenantId: string, event: string, data: any): Promise<void> {
  console.log(`[Stub] Persisting audit event: ${event}`);
}

async function waitForApproval(decisionId: string, tenantId: string): Promise<boolean> {
  console.log(`[Stub] Waiting for approval: ${decisionId}`);
  return true; // Placeholder
}

async function retrieveApprovedDecision(decisionId: string, tenantId: string): Promise<any> {
  console.log(`[Stub] Retrieving approved decision: ${decisionId}`);
  return {};
}

async function executeGovernanceDecision(decision: any): Promise<void> {
  console.log(`[Stub] Executing governance decision`, decision);
}
