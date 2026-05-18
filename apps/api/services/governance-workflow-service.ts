import { PoolClient } from 'pg';

export type GovernanceWorkflowState =
  | 'PROPOSED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ESCALATED'
  | 'CONDITIONAL'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'UNDER_INVESTIGATION'
  | 'QUARANTINED';

export type ApprovalCaveatType =
  | 'REQUIRES_RETENTION_REVIEW'
  | 'HIGH_VARIANCE_DECISION'
  | 'TEMPORARY_OVERRIDE'
  | 'BUSINESS_CONTEXT_REQUIRED'
  | 'SECURITY_REVIEW_PENDING'
  | 'POLICY_EXCEPTION'
  | 'COST_THRESHOLD_EXCEEDED';

export type CaveatSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface WorkflowStateTransition {
  transitionId: string;
  reviewId: string;
  indexName: string;
  fromState: GovernanceWorkflowState;
  toState: GovernanceWorkflowState;
  transitionReason?: string;
  transitionedBy: string;
  transitionedAt: Date;
  newCaveatType?: ApprovalCaveatType;
  newCaveatValidUntil?: Date;
  isAutomaticTransition: boolean;
}

export interface ConditionalApprovalCaveat {
  caveatId: string;
  reviewId: string;
  indexName: string;
  caveatType: ApprovalCaveatType;
  caveatDescription: string;
  caveatSeverity: CaveatSeverity;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
}

export interface GovernanceInvestigation {
  investigationId: string;
  reviewId: string;
  indexName: string;
  investigationReason: string;
  investigationInitiatedBy: string;
  investigationInitiatedAt: Date;
  investigationStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  assignedTo?: string;
  assignedAt?: Date;
  findings?: string;
  findingsSeverity?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  conclusion?: string;
  investigationClosedAt?: Date;
  closedBy?: string;
  actionTaken?: string;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<GovernanceWorkflowState, GovernanceWorkflowState[]> = {
  PROPOSED: ['APPROVED', 'REJECTED', 'ESCALATED', 'CONDITIONAL'],
  APPROVED: ['EXPIRED', 'UNDER_INVESTIGATION', 'SUPERSEDED'],
  REJECTED: [],
  ESCALATED: ['APPROVED', 'REJECTED', 'CONDITIONAL'],
  CONDITIONAL: ['APPROVED', 'EXPIRED', 'SUPERSEDED'],
  EXPIRED: ['APPROVED'],
  SUPERSEDED: [],
  UNDER_INVESTIGATION: ['APPROVED', 'QUARANTINED'],
  QUARANTINED: [],
};

// Transitions requiring reason
const TRANSITIONS_REQUIRING_REASON = new Set([
  'PROPOSED->REJECTED',
  'PROPOSED->ESCALATED',
  'PROPOSED->CONDITIONAL',
  'APPROVED->EXPIRED',
  'APPROVED->UNDER_INVESTIGATION',
  'ESCALATED->APPROVED',
  'ESCALATED->REJECTED',
  'ESCALATED->CONDITIONAL',
  'UNDER_INVESTIGATION->APPROVED',
  'UNDER_INVESTIGATION->QUARANTINED',
]);

/**
 * Transition a review from one state to another
 */
export async function transitionWorkflowState(
  client: PoolClient,
  reviewId: string,
  indexName: string,
  fromState: GovernanceWorkflowState,
  toState: GovernanceWorkflowState,
  transitionedBy: string,
  options?: {
    reason?: string;
    caveatType?: ApprovalCaveatType;
    caveatValidUntil?: Date;
    isAutomatic?: boolean;
  }
): Promise<{ transition: WorkflowStateTransition; success: boolean; error?: string }> {
  // Validate transition is allowed
  const validNextStates = VALID_TRANSITIONS[fromState];
  if (!validNextStates.includes(toState)) {
    return {
      transition: {} as WorkflowStateTransition,
      success: false,
      error: `Invalid transition: ${fromState} -> ${toState}`,
    };
  }

  // Check if reason is required
  const requiresReason = TRANSITIONS_REQUIRING_REASON.has(`${fromState}->${toState}`);
  if (requiresReason && !options?.reason) {
    return {
      transition: {} as WorkflowStateTransition,
      success: false,
      error: `Transition ${fromState} -> ${toState} requires a reason`,
    };
  }

  // Create transition record
  const transitionResult = await client.query(
    `INSERT INTO governance_workflow_transitions (
      review_id, index_name,
      from_state, to_state, transition_reason,
      transitioned_by, is_automatic_transition,
      new_caveat_type, new_caveat_valid_until
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      reviewId,
      indexName,
      fromState,
      toState,
      options?.reason || null,
      transitionedBy,
      options?.isAutomatic || false,
      options?.caveatType || null,
      options?.caveatValidUntil || null,
    ]
  );

  const transition = parseTransition(transitionResult.rows[0]);

  // Update human_review_ledger with new state
  await client.query(
    `UPDATE human_review_ledger SET
      workflow_state = $1,
      caveat_type = $2,
      caveat_valid_until = $3,
      escalation_reason = CASE WHEN $4 = 'ESCALATED' THEN $5 ELSE escalation_reason END
    WHERE review_id = $6`,
    [
      toState,
      options?.caveatType || null,
      options?.caveatValidUntil || null,
      toState,
      options?.reason || null,
      reviewId,
    ]
  );

  return { transition, success: true };
}

/**
 * Create a conditional approval with caveat
 */
export async function createConditionalApprovalWithCaveat(
  client: PoolClient,
  reviewId: string,
  indexName: string,
  caveatType: ApprovalCaveatType,
  caveatDescription: string,
  caveatSeverity: CaveatSeverity,
  validUntil: Date,
  transitionedBy: string
): Promise<{ caveat: ConditionalApprovalCaveat; transition: WorkflowStateTransition }> {
  // Get current state
  const reviewResult = await client.query(
    `SELECT workflow_state FROM human_review_ledger WHERE review_id = $1`,
    [reviewId]
  );

  const currentState = reviewResult.rows[0].workflow_state as GovernanceWorkflowState;

  // Transition to CONDITIONAL if not already
  let transition: WorkflowStateTransition;
  if (currentState !== 'CONDITIONAL') {
    const transitionResult = await transitionWorkflowState(
      client,
      reviewId,
      indexName,
      currentState,
      'CONDITIONAL',
      transitionedBy,
      { caveatType, caveatValidUntil: validUntil }
    );
    if (!transitionResult.success) {
      throw new Error(transitionResult.error);
    }
    transition = transitionResult.transition;
  } else {
    // Create transition record anyway
    const transitionResult = await client.query(
      `INSERT INTO governance_workflow_transitions (
        review_id, index_name, from_state, to_state,
        transitioned_by, new_caveat_type, new_caveat_valid_until,
        is_automatic_transition
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [reviewId, indexName, 'CONDITIONAL', 'CONDITIONAL', transitionedBy, caveatType, validUntil, false]
    );
    transition = parseTransition(transitionResult.rows[0]);
  }

  // Create caveat record
  const caveatResult = await client.query(
    `INSERT INTO conditional_approval_registry (
      review_id, index_name,
      caveat_type, caveat_description, caveat_severity,
      valid_from, valid_until, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      reviewId,
      indexName,
      caveatType,
      caveatDescription,
      caveatSeverity,
      new Date(),
      validUntil,
      true,
    ]
  );

  const caveat = parseCaveat(caveatResult.rows[0]);
  return { caveat, transition };
}

/**
 * Resolve a caveat (marks as inactive)
 */
export async function resolveCaveat(
  client: PoolClient,
  caveatId: string,
  resolvedBy: string,
  resolutionNotes?: string
): Promise<ConditionalApprovalCaveat> {
  const result = await client.query(
    `UPDATE conditional_approval_registry SET
      is_active = FALSE,
      resolved_by = $1,
      resolved_at = NOW(),
      resolution_notes = $2
    WHERE caveat_id = $3
    RETURNING *`,
    [resolvedBy, resolutionNotes || null, caveatId]
  );

  return parseCaveat(result.rows[0]);
}

/**
 * Initiate an investigation on a review
 */
export async function initiateInvestigation(
  client: PoolClient,
  reviewId: string,
  indexName: string,
  investigationReason: string,
  investigationInitiatedBy: string
): Promise<{ investigation: GovernanceInvestigation; transition: WorkflowStateTransition }> {
  // Get current state
  const reviewResult = await client.query(
    `SELECT workflow_state FROM human_review_ledger WHERE review_id = $1`,
    [reviewId]
  );

  const currentState = reviewResult.rows[0].workflow_state as GovernanceWorkflowState;

  // Transition to UNDER_INVESTIGATION
  const transitionResult = await transitionWorkflowState(
    client,
    reviewId,
    indexName,
    currentState,
    'UNDER_INVESTIGATION',
    investigationInitiatedBy,
    { reason: investigationReason }
  );

  if (!transitionResult.success) {
    throw new Error(transitionResult.error);
  }

  // Create investigation record
  const invResult = await client.query(
    `INSERT INTO governance_investigation_ledger (
      review_id, index_name,
      investigation_reason, investigation_initiated_by,
      investigation_status
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [reviewId, indexName, investigationReason, investigationInitiatedBy, 'OPEN']
  );

  return {
    investigation: parseInvestigation(invResult.rows[0]),
    transition: transitionResult.transition,
  };
}

/**
 * Update investigation progress
 */
export async function updateInvestigationStatus(
  client: PoolClient,
  investigationId: string,
  newStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
  options?: {
    assignedTo?: string;
    findings?: string;
    severity?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    conclusion?: string;
    closedBy?: string;
    actionTaken?: string;
  }
): Promise<GovernanceInvestigation> {
  const result = await client.query(
    `UPDATE governance_investigation_ledger SET
      investigation_status = $1,
      assigned_to = COALESCE($2, assigned_to),
      assigned_at = CASE WHEN $2 IS NOT NULL THEN NOW() ELSE assigned_at END,
      findings = COALESCE($3, findings),
      findings_severity = COALESCE($4, findings_severity),
      conclusion = COALESCE($5, conclusion),
      investigation_closed_at = CASE WHEN $1 = 'CLOSED' THEN NOW() ELSE investigation_closed_at END,
      closed_by = COALESCE($6, closed_by),
      action_taken = COALESCE($7, action_taken)
    WHERE investigation_id = $8
    RETURNING *`,
    [
      newStatus,
      options?.assignedTo || null,
      options?.findings || null,
      options?.severity || null,
      options?.conclusion || null,
      options?.closedBy || null,
      options?.actionTaken || null,
      investigationId,
    ]
  );

  return parseInvestigation(result.rows[0]);
}

/**
 * Get active caveats for a review
 */
export async function getActiveCaveats(
  client: PoolClient,
  reviewId: string
): Promise<ConditionalApprovalCaveat[]> {
  const result = await client.query(
    `SELECT * FROM conditional_approval_registry
     WHERE review_id = $1 AND is_active = TRUE
     ORDER BY valid_until ASC`,
    [reviewId]
  );

  return result.rows.map(parseCaveat);
}

/**
 * Get recent transitions for a review
 */
export async function getRecentTransitions(
  client: PoolClient,
  reviewId: string,
  limit: number = 10
): Promise<WorkflowStateTransition[]> {
  const result = await client.query(
    `SELECT * FROM governance_workflow_transitions
     WHERE review_id = $1
     ORDER BY transitioned_at DESC
     LIMIT $2`,
    [reviewId, limit]
  );

  return result.rows.map(parseTransition);
}

/**
 * Get investigation for a review
 */
export async function getInvestigationForReview(
  client: PoolClient,
  reviewId: string
): Promise<GovernanceInvestigation | null> {
  const result = await client.query(
    `SELECT * FROM governance_investigation_ledger
     WHERE review_id = $1
     ORDER BY investigation_initiated_at DESC
     LIMIT 1`,
    [reviewId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return parseInvestigation(result.rows[0]);
}

/**
 * Check if review can be approved (no blocking investigations)
 */
export async function canApproveReview(
  client: PoolClient,
  reviewId: string
): Promise<{ canApprove: boolean; blockingReason?: string }> {
  // Check for open investigations
  const invResult = await client.query(
    `SELECT * FROM governance_investigation_ledger
     WHERE review_id = $1
     AND investigation_status != 'CLOSED'`,
    [reviewId]
  );

  if (invResult.rows.length > 0) {
    return {
      canApprove: false,
      blockingReason: 'Open investigation in progress',
    };
  }

  // Check for expired caveats
  const caveatResult = await client.query(
    `SELECT * FROM conditional_approval_registry
     WHERE review_id = $1
     AND is_active = TRUE
     AND valid_until < NOW()`,
    [reviewId]
  );

  if (caveatResult.rows.length > 0) {
    return {
      canApprove: false,
      blockingReason: 'One or more caveats have expired',
    };
  }

  return { canApprove: true };
}

/**
 * Parse database row into WorkflowStateTransition
 */
function parseTransition(row: any): WorkflowStateTransition {
  return {
    transitionId: row.transition_id,
    reviewId: row.review_id,
    indexName: row.index_name,
    fromState: row.from_state,
    toState: row.to_state,
    transitionReason: row.transition_reason,
    transitionedBy: row.transitioned_by,
    transitionedAt: new Date(row.transitioned_at),
    newCaveatType: row.new_caveat_type,
    newCaveatValidUntil: row.new_caveat_valid_until ? new Date(row.new_caveat_valid_until) : undefined,
    isAutomaticTransition: row.is_automatic_transition,
  };
}

/**
 * Parse database row into ConditionalApprovalCaveat
 */
function parseCaveat(row: any): ConditionalApprovalCaveat {
  return {
    caveatId: row.caveat_id,
    reviewId: row.review_id,
    indexName: row.index_name,
    caveatType: row.caveat_type,
    caveatDescription: row.caveat_description,
    caveatSeverity: row.caveat_severity,
    validFrom: new Date(row.valid_from),
    validUntil: new Date(row.valid_until),
    isActive: row.is_active,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    resolutionNotes: row.resolution_notes,
  };
}

/**
 * Parse database row into GovernanceInvestigation
 */
function parseInvestigation(row: any): GovernanceInvestigation {
  return {
    investigationId: row.investigation_id,
    reviewId: row.review_id,
    indexName: row.index_name,
    investigationReason: row.investigation_reason,
    investigationInitiatedBy: row.investigation_initiated_by,
    investigationInitiatedAt: new Date(row.investigation_initiated_at),
    investigationStatus: row.investigation_status,
    assignedTo: row.assigned_to,
    assignedAt: row.assigned_at ? new Date(row.assigned_at) : undefined,
    findings: row.findings,
    findingsSeverity: row.findings_severity,
    conclusion: row.conclusion,
    investigationClosedAt: row.investigation_closed_at ? new Date(row.investigation_closed_at) : undefined,
    closedBy: row.closed_by,
    actionTaken: row.action_taken,
  };
}
