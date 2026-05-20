/**
 * OPA Policy Types
 *
 * Defines the contract between the application and OPA.
 * All policy decisions are traced and emitted as pipeline_events.
 */

export type PolicyDecision = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export type PolicyProfile =
  | 'cost_optimization'
  | 'security_first'
  | 'operations_focused'
  | 'conservative'
  | 'data_quality';

/**
 * Input to OPA policy evaluation.
 * All fields are deterministic from source (Splunk, DB, or system).
 */
export interface PolicyInput {
  tenantId: string;
  decisionId: string;
  indexName: string;
  proposedAction: 'KEEP' | 'OPTIMIZE' | 'ARCHIVE' | 'ELIMINATE' | 'MONITOR';
  scores: {
    utilization: number;
    detection: number;
    quality: number;
    composite: number;
    risk?: number;
  };
  economics: {
    annualCostUsd: number;
    estimatedSavingsUsd: number;
  };
  evidence: {
    source: 'splunk' | 'postgres' | 'system';
    mode: 'live';
    traceId: string;
  };
}

/**
 * Result of OPA policy evaluation.
 * Always includes trace context.
 * Always emitted as pipeline_event before returned to caller.
 */
export interface PolicyResult {
  decision: PolicyDecision;
  violatedGuardrails: string[];
  requiredApprovals: string[];
  confidence: number;
  policyProfile: PolicyProfile;
  source: 'system';
  mode: 'live';
  traceId: string;
}
