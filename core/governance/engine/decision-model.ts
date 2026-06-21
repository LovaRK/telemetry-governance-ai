/**
 * Governance Decision Model
 * Defines all domain types and interfaces for the Runtime Governance Engine (RGE).
 *
 * These types are normative per PHASE_2A_RUNTIME_GOVERNANCE_ENGINE_SPEC.md
 * Non-compliant implementations must be rejected.
 */

/**
 * Governance Decision Enum
 * Seven-state model for all governance decisions.
 */
export enum Decision {
  ALLOW = "ALLOW",
  DENY = "DENY",
  REQUIRE_APPROVAL = "REQUIRE_APPROVAL",
  REQUIRE_ESCALATION = "REQUIRE_ESCALATION",
  SIMULATE_ONLY = "SIMULATE_ONLY",
  SANDBOX_ONLY = "SANDBOX_ONLY",
  READ_ONLY = "READ_ONLY"
}

/**
 * Risk Level Classification
 * Drives escalation chains, approval counts, and enforcement strictness.
 */
export enum RiskLevel {
  LOW = "LOW",
  MODERATE = "MODERATE",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL"
}

/**
 * Governance Evaluation
 * Result of policy reasoning (not authorization).
 * Evaluations can be repeated; they represent analysis.
 */
export interface GovernanceEvaluation {
  // Policy reasoning
  decision: Decision;
  risk_level: RiskLevel;
  matched_policy_ids: string[];
  reasons: string[];

  // Schema versioning for replay and migration
  decision_schema_version: string;
  policy_schema_version: string;

  // Metadata
  evaluation_id: string;
  trace_id: string;
  created_at: string;
}

/**
 * Execution Authorization
 * Discrete permission grant (not evaluation).
 * Authorizations are granted once, expire, and can be revoked.
 * Critical for separating "reasoning" from "permission".
 */
export interface ExecutionAuthorization {
  // Permission grant
  authorized: boolean;
  authorization_id: string;

  // Authority
  authorized_by: string;
  authorized_at: string;

  // Scope limits
  approval_scope: string[];

  // Temporal constraints
  expires_at?: string; // TTL for approval (may be null for permanent)

  // Revocation
  revoked: boolean;
  revoked_at?: string;
  revocation_reason?: string;

  // Replay protection (prevents authorization reuse)
  nonce: string; // Unique per execution request
  execution_token: string; // Tied to execution context
  authorization_signature: string; // HMAC-SHA256(auth_id + nonce + plan_hash + secret)

  // Schema versioning
  authorization_schema_version: string;
}

/**
 * Governance Decision
 * Complete governance decision result.
 * MUST be returned by every governance evaluation.
 */
export interface GovernanceDecision {
  // Decision verdict
  decision: Decision;
  risk_level: RiskLevel;

  // Decision identity (deterministic, for audit and replay)
  decision_id: string; // Derived from normalized inputs ONLY
  input_fingerprint: string; // SHA256(normalized_input) for forensic grouping and replay detection

  // Schema versioning (for audit replay and policy migration)
  decision_schema_version: string;
  policy_schema_version: string;

  // Request tracing (correlation fabric)
  trace_id: string;
  correlation_id: string;
  causation_id?: string; // parent action, if any

  // Actor information
  actor_id: string;
  actor_type: "human" | "agent" | "service";

  // Execution context
  environment: string; // "sandbox" | "production"
  action: string; // e.g., "SAVE_SPLUNK_CONFIG", "EXECUTE_REMEDIATION"
  resource: string; // What is being governed

  // Policy evaluation results
  matched_policy_ids: string[];
  policy_snapshot_hash: string;

  // Explanation (for operators and future agents)
  reasons: string[];

  // Enforcement semantics
  enforcement_mode: "hard-block" | "soft-block" | "approval-required" | "simulation";

  // Time constraints
  created_at: string; // ISO 8601 (metadata only, NOT in decision identity)
  expires_at?: string; // Decision TTL (some decisions expire, e.g., temporary approvals)

  // Optional: Authorization details (if approval required)
  required_authorization?: ExecutionAuthorization;
}

/**
 * Evaluation Request
 * Input to governance evaluation.
 */
export interface GovernanceEvaluationRequest {
  action: string;
  actor_id: string;
  actor_type: "human" | "agent" | "service";
  resource: string;
  trace_id: string;
  correlation_id: string;
  causation_id?: string;
  policy_snapshot_hash: string;
  // Phase 4.5 additions — optional for backward compatibility
  risk_level?: RiskLevel | string;  // Pre-classified risk; used by DSL policy evaluator
  tenant_id?: string;               // Required for tenant-scoped policy evaluation
  metadata?: Record<string, unknown>; // Arbitrary context for policy conditions
}

/**
 * Policy Evaluation Result (Internal)
 * Intermediate result from policy evaluation.
 */
export interface PolicyEvaluationResult {
  decision: Decision;
  risk_level: RiskLevel;
  matched_policy_ids: string[];
  reasons: string[];
}
