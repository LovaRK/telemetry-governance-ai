/**
 * Policy Engine with Event Sourcing Integration
 *
 * Implements the POLICY_EVENT_CONTRACT specification.
 * Every policy evaluation is captured as an immutable sequence of events:
 * 1. POLICY_VALIDATION_EXECUTED — Initial reasoning & constraint analysis
 * 2. POLICY_ENFORCEMENT_BLOCKED/ALLOWED/REQUIRES_APPROVAL — Terminal decision
 *
 * This creates an auditable, replayable governance decision log.
 */

import {
  emitPipelineEvent,
  createExecution,
  updateExecutionStage,
  buildGovernanceMetadata,
  getExecutionTimeline,
  EventTaxonomy,
  EventSeverity,
  PipelineEvent,
} from '../database/pipeline-events';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type GovernanceDomain = 'SECURITY' | 'COST' | 'RELIABILITY' | 'COMPLIANCE' | 'RETENTION';

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type ActionType = 'DISABLE_PCI_LOGS' | 'DROP_PROD_SPANS' | 'STRIP_STAGING_DEBUG';

export interface PolicyEvaluationInput {
  // Execution context
  executionId?: string;
  correlationId?: string;

  // Action being evaluated
  actionType: ActionType;
  targetService: string;
  targetCluster: string;

  // Request payload
  payload?: Record<string, any>;

  // Optional actor override (default: engine:policy_containment)
  actor?: string;

  // Session tracking
  operatorSessionId?: string;
}

export interface PolicyEvaluationResult {
  status: 'BLOCKED' | 'APPROVAL_REQUIRED' | 'ALLOWED';
  executionId: string;
  correlationId: string;
  reason?: string;
  riskLevel: RiskLevel;
}

// ============================================================================
// POLICY GUARDRAIL DEFINITIONS
// ============================================================================

const FORBIDDEN_ACTIONS: ActionType[] = ['DISABLE_PCI_LOGS'];
const APPROVAL_REQUIRED_ACTIONS: ActionType[] = ['DROP_PROD_SPANS'];
const AUTO_APPROVED_ACTIONS: ActionType[] = ['STRIP_STAGING_DEBUG'];

const ACTION_GOVERNANCE_DOMAIN: Record<ActionType, GovernanceDomain> = {
  DISABLE_PCI_LOGS: 'COMPLIANCE',
  DROP_PROD_SPANS: 'COST',
  STRIP_STAGING_DEBUG: 'RELIABILITY',
};

const ACTION_RISK_LEVEL: Record<ActionType, RiskLevel> = {
  DISABLE_PCI_LOGS: 'CRITICAL',
  DROP_PROD_SPANS: 'HIGH',
  STRIP_STAGING_DEBUG: 'LOW',
};

const ACTION_BLAST_RADIUS: Record<ActionType, string> = {
  DISABLE_PCI_LOGS: 'CRITICAL',
  DROP_PROD_SPANS: 'MEDIUM',
  STRIP_STAGING_DEBUG: 'LOW',
};

const POLICY_VERSION = '2026.05.19.1';

// ============================================================================
// CORE POLICY EVALUATION ENGINE
// ============================================================================

/**
 * Execute policy evaluation with full event sourcing
 *
 * Implements the monotonic event-sourced lifecycle:
 * 1. Emit POLICY_VALIDATION_EXECUTED (baseline reasoning)
 * 2. Emit terminal decision event (BLOCKED/APPROVAL_REQUIRED/ALLOWED)
 *
 * @param input Policy evaluation input
 * @returns Policy evaluation result with status and risk classification
 */
export async function executePolicyEvaluation(
  input: PolicyEvaluationInput
): Promise<PolicyEvaluationResult> {
  // Bootstrap execution context if not provided
  const executionId = input.executionId || uuidv4();
  const correlationId = input.correlationId || uuidv4();
  const actor = input.actor || 'engine:policy_containment';

  try {
    // Initialize execution record
    await createExecution({
      execution_id: executionId,
      correlation_id: correlationId,
      current_stage: 'DECISION_GATE',
      metadata: {
        policy_domain: ACTION_GOVERNANCE_DOMAIN[input.actionType],
        action_type: input.actionType,
        target_service: input.targetService,
        target_cluster: input.targetCluster,
      },
    });

    // ========================================================================
    // STEP 1: POLICY_VALIDATION_EXECUTED
    // ========================================================================
    // Emit the baseline reasoning milestone instantly
    // This captures the raw constraint analysis before any terminal decision

    const riskLevel = ACTION_RISK_LEVEL[input.actionType];
    const governanceDomain = ACTION_GOVERNANCE_DOMAIN[input.actionType];
    const blastRadius = ACTION_BLAST_RADIUS[input.actionType];

    await emitPipelineEvent({
      execution_id: executionId,
      correlation_id: correlationId,
      sequence: 1, // First event in monotonic sequence
      actor,
      operator_session_id: input.operatorSessionId,
      event_type: 'POLICY_VALIDATION_EXECUTED',
      taxonomy: 'POLICY',
      severity: getRiskSeverity(riskLevel),
      timestamp: new Date().toISOString(),
      message: `Governance Engine evaluating ${input.actionType} policy evaluation for ${input.targetService}.`,
      payload: {
        policy_name: 'INFRASTRUCTURE_TELEMETRY_GOVERNANCE_RULES',
        policy_version: POLICY_VERSION,
        governance_domain: governanceDomain,
        risk_level: riskLevel,
        blast_radius: blastRadius,
        requires_approval: APPROVAL_REQUIRED_ACTIONS.includes(input.actionType),
        rollback_available: !FORBIDDEN_ACTIONS.includes(input.actionType),
        affected_resources: [`${input.targetCluster}:pods:${input.targetService}`],
        confidence_score: 0.94,
        matched_rules: [input.actionType],
        decision_snapshot: {
          input_proposal: input.payload || {},
          evaluated_constraints: {
            environment: 'production',
            cluster_id: input.targetCluster,
            action_type: input.actionType,
          },
          resolved_recommendation: `Assess policy compliance constraints matching rule: ${input.actionType}`,
        },
      },
    });

    // ========================================================================
    // STEP 2: TERMINAL DECISION EVENT
    // ========================================================================
    // Emit the outcome event based on guardrail evaluation

    if (FORBIDDEN_ACTIONS.includes(input.actionType)) {
      // VECTOR A: Hard compliance violation → CRITICAL block
      await emitPipelineEvent({
        execution_id: executionId,
        correlation_id: correlationId,
        sequence: 2, // Strict monotonic progression
        actor,
        operator_session_id: input.operatorSessionId,
        event_type: 'POLICY_ENFORCEMENT_BLOCKED',
        taxonomy: 'POLICY',
        severity: 'CRITICAL',
        timestamp: new Date().toISOString(),
        message: `Policy Engine BLOCKED autonomous execution: Violation of compliance rule 'FORBIDDEN_${input.actionType}'.`,
        payload: {
          policy_version: POLICY_VERSION,
          error_code: 'ERR_COMPLIANCE_VIOLATION',
          violation_type: 'HARD_STOP_GUARDRAIL',
        },
        governance: buildGovernanceMetadata({
          matched_policies: ['COMPLIANCE_HARD_STOP'],
          requires_approval: false,
          rollback_available: false,
        }),
      });

      await updateExecutionStage(executionId, 'FAILED', {
        failure_reason: 'Hard compliance restriction violated',
      });

      return {
        status: 'BLOCKED',
        executionId,
        correlationId,
        reason: 'Hard compliance restriction violated',
        riskLevel: 'CRITICAL',
      };
    }

    if (APPROVAL_REQUIRED_ACTIONS.includes(input.actionType)) {
      // VECTOR B: High-risk operation → approval gate
      await emitPipelineEvent({
        execution_id: executionId,
        correlation_id: correlationId,
        sequence: 2,
        actor,
        operator_session_id: input.operatorSessionId,
        event_type: 'POLICY_APPROVAL_REQUIRED',
        taxonomy: 'POLICY',
        severity: 'WARN',
        timestamp: new Date().toISOString(),
        message: `Policy Engine verified structural validity. Human-in-the-loop authorization required for action '${input.actionType}'.`,
        payload: {
          policy_version: POLICY_VERSION,
          risk_classification: 'HIGH',
          blast_radius: blastRadius,
        },
        governance: buildGovernanceMetadata({
          matched_policies: ['HIGH_RISK_OPERATION'],
          requires_approval: true,
          rollback_available: true,
          rollback_metadata: {
            recovery_mechanism: 'GITOPS_WEBHOOK_REVERT',
            estimated_recovery_time_secs: 120,
            target_configuration_hash: 'cfg_pre_incident_v2',
          },
        }),
      });

      await updateExecutionStage(executionId, 'DECISION_GATE', {
        requires_approval: true,
      });

      return {
        status: 'APPROVAL_REQUIRED',
        executionId,
        correlationId,
        reason: 'High-risk operation requires human approval',
        riskLevel: 'HIGH',
      };
    }

    // Auto-approved low-risk operations
    await emitPipelineEvent({
      execution_id: executionId,
      correlation_id: correlationId,
      sequence: 2,
      actor,
      operator_session_id: input.operatorSessionId,
      event_type: 'POLICY_ENFORCEMENT_ALLOWED',
      taxonomy: 'POLICY',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      message: `Policy Engine approved auto-remediation rule. Routing transaction directly to downstream async worker pool.`,
      payload: {
        policy_version: POLICY_VERSION,
        risk_classification: 'LOW',
      },
      governance: buildGovernanceMetadata({
        matched_policies: ['AUTO_REMEDIATION_APPROVED'],
        requires_approval: false,
        rollback_available: true,
      }),
    });

    await updateExecutionStage(executionId, 'EXECUTING', {
      approved: true,
    });

    return {
      status: 'ALLOWED',
      executionId,
      correlationId,
      riskLevel: 'LOW',
    };
  } catch (error) {
    console.error(`[PolicyEngine] Evaluation failed:`, error);
    throw error;
  }
}

/**
 * Operator Override: Grant approval for high-risk operations requiring human authorization
 *
 * Emits Seq 3 event (OPERATOR_APPROVAL_GRANTED) to complete the cascade:
 * - Seq 1: POLICY_VALIDATION_EXECUTED (reasoning)
 * - Seq 2: POLICY_APPROVAL_REQUIRED (human gate)
 * - Seq 3: OPERATOR_APPROVAL_GRANTED (authorization)
 *
 * @param executionId Execution to approve (must have DECISION_GATE stage)
 * @param operatorSessionId Operator identity (anonymizable)
 * @param approvalReason Optional explanation for the override
 * @returns Approval confirmation with timeline details
 */
export async function approveOperatorDecision(
  executionId: string,
  operatorSessionId: string,
  approvalReason?: string
): Promise<{ status: 'APPROVED'; executionId: string; sequenceNumber: number }> {
  try {
    // Retrieve execution record to get correlation_id and last sequence
    const executionTimeline = await getExecutionTimeline(executionId);
    if (!executionTimeline || executionTimeline.length === 0) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    const correlationId = executionTimeline[0].correlation_id;
    const lastSequence = Math.max(...executionTimeline.map((e: PipelineEvent) => e.sequence), 0);

    // Emit Seq 3: Operator authorization event
    const result = await emitPipelineEvent({
      execution_id: executionId,
      correlation_id: correlationId,
      sequence: lastSequence + 1,
      actor: 'operator:' + operatorSessionId,
      operator_session_id: operatorSessionId,
      event_type: 'OPERATOR_APPROVAL_GRANTED',
      taxonomy: 'OPERATOR',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      message: `Operator authorized human-in-the-loop override. Proceeding to downstream execution stage.${approvalReason ? ` Reason: ${approvalReason}` : ''}`,
      payload: {
        approval_reason: approvalReason || null,
      },
      governance: buildGovernanceMetadata({
        matched_policies: ['OPERATOR_OVERRIDE_GRANTED'],
        requires_approval: false,
        rollback_available: true,
      }),
    });

    // Transition execution to EXECUTING stage
    await updateExecutionStage(executionId, 'EXECUTING', {
      operator_approved: true,
      approval_timestamp: new Date().toISOString(),
      approval_reason: approvalReason,
    });

    console.log(`[PolicyEngine] Operator approval granted: ${executionId} (seq: ${result.sequence})`);

    return {
      status: 'APPROVED',
      executionId,
      sequenceNumber: result.sequence,
    };
  } catch (error) {
    console.error(`[PolicyEngine] Operator approval failed:`, error);
    throw error;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Map RiskLevel to EventSeverity
 */
function getRiskSeverity(riskLevel: RiskLevel): EventSeverity {
  const mapping: Record<RiskLevel, EventSeverity> = {
    CRITICAL: 'CRITICAL',
    HIGH: 'WARN',
    MEDIUM: 'INFO',
    LOW: 'INFO',
    INFO: 'INFO',
  };
  return mapping[riskLevel];
}

/**
 * Get human-readable description of a governance domain
 */
export function describeGovernanceDomain(domain: GovernanceDomain): string {
  const descriptions: Record<GovernanceDomain, string> = {
    SECURITY: 'Security & Credential Protection',
    COST: 'Cost Optimization & Waste Reduction',
    RELIABILITY: 'SLO/SLA Compliance & Uptime',
    COMPLIANCE: 'Regulatory & Statutory Compliance',
    RETENTION: 'Data Lifecycle & Retention Policies',
  };
  return descriptions[domain];
}
