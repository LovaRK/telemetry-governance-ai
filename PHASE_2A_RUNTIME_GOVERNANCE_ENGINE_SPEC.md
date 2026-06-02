# PHASE 2A: Runtime Governance Engine Specification

**Status**: NORMATIVE - This document defines authoritative platform contracts  
**Effective**: Phase 2A implementation  
**Compliance**: Non-compliant runtime behavior must disable autonomous execution  
**Last Updated**: 2026-05-28

---

## 1. Purpose

The **Runtime Governance Engine (RGE)** is the deterministic decision and execution-governance substrate for the platform.

The RGE is responsible for:
- ✅ Policy evaluation (deterministic, repeatable)
- ✅ Execution eligibility determination
- ✅ Approval requirement routing
- ✅ Runtime containment enforcement
- ✅ Operational audit lineage
- ✅ Fail-closed execution guarantees

**This document is normative.**

If runtime behavior diverges from this specification:
1. Runtime MUST be treated as non-compliant
2. Autonomous execution MUST be disabled
3. Incident MUST be logged and escalated

---

## 2. Governance Principles

### 2.1 Deterministic Governance (MANDATORY)

**Invariant**: The same governance inputs MUST always produce the same decision.

```
Given:
  action = "SAVE_SPLUNK_CONFIG"
  actor_id = "agent-123"
  resource = "splunk:config:45.76.167.6:8089"
  environment = "sandbox"
  policy_snapshot_hash = "abc123..."

Then:
  All evaluations MUST return: Decision::DENY
  
If any evaluation returns: Decision::ALLOW
  → GOVERNANCE VIOLATION
  → Autonomous execution DISABLED
  → Incident escalated to security team
```

**Implications**:
- Non-deterministic RNG in policy evaluation is prohibited
- Non-deterministic environment variables are prohibited
- Randomized approval routing is prohibited
- Policy snapshots MUST be versioned and frozen at decision time

---

### 2.2 Fail-Closed Execution (MANDATORY)

**Invariant**: If ANY of these conditions occur, execution MUST NOT proceed.

```
If governance_engine_unavailable:
  → execution = DISABLED
  
Else if environment_undefined:
  → execution = DISABLED
  
Else if policy_snapshot_missing:
  → execution = DISABLED
  
Else if approval_state_indeterminate:
  → execution = DISABLED
  
Else if execution_plan_hash_mismatch:
  → execution = DISABLED
  
Else if governance_integrity_check_fails:
  → execution = DISABLED
  
Otherwise:
  → proceed with governance decision
```

**No permissive fallback modes are allowed.**

Examples of violations:
- ❌ "Governance unavailable, proceed anyway"
- ❌ "Approval missing, execute in read-only"
- ❌ "Policy evaluation timed out, use cached decision"

---

### 2.3 Immutable Operational Intent (MANDATORY)

**Invariant**: Once an execution plan is approved, it is immutable.

An execution plan consists of:
- Normalized action list
- Deterministic action ordering
- Resolved target identifiers
- Execution parameters
- Approval scope
- Policy snapshot (frozen)

**These fields MUST NOT mutate** after approval:
```typescript
interface ApprovedExecutionPlan {
  plan_id: string
  plan_hash: string  // SHA256 of normalized plan
  actions: NormalizedAction[]
  resolved_targets: string[]
  parameters: { [key: string]: any }
  approval_snapshot: ApprovalRecord
  policy_snapshot_hash: string
  approved_at: string
  approved_by: string
  created_at: string  // immutable
}
```

**Any mutation requires**:
1. Compute new plan hash
2. Re-evaluate governance decision
3. Obtain new approval
4. New plan_id assigned

Example:
```
Approved plan:
  action: "remediate_endpoint"
  target: "server-42"
  plan_hash: "abc123..."
  approved_by: "operator-1"
  approved_at: "2026-05-28T10:00:00Z"

Mutation attempt:
  target: "server-99"  ← DIFFERENT

Result:
  ✗ REJECT (hash mismatch)
  → Requires new approval
```

---

### 2.4 Human Governance Priority (MANDATORY)

**Invariant**: Human operators retain ultimate authority over:
- Approval decisions
- Escalation routing
- Rollback/undo operations
- Emergency halt
- Policy override

Autonomous execution is **delegated authority**, not sovereign authority.

Example:
```
Agent submits: "Execute remediation X"
RGE evaluates: Decision::REQUIRE_APPROVAL
Human approves with scope limits: "Execute only on staging"
Agent execution: Constrained to staging environment
Agent attempts to override: DENIED (scope violation)
Human can revoke approval: Execution halted immediately
```

---

## 3. Decision Model

### 3.1 Decision Enum (NORMATIVE)

```typescript
enum Decision {
  // Explicit execution allowed
  ALLOW,
  
  // Explicit execution blocked
  DENY,
  
  // Execution requires human approval
  REQUIRE_APPROVAL,
  
  // Escalate to senior operator (approval alone insufficient)
  REQUIRE_ESCALATION,
  
  // Execute in simulation mode only (no persistence)
  SIMULATE_ONLY,
  
  // Execute in sandbox environment only
  SANDBOX_ONLY,
  
  // Read-only access only (no mutations)
  READ_ONLY
}
```

### 3.2 Risk Level Classification (NORMATIVE)

```typescript
enum RiskLevel {
  LOW,        // Read-only, informational, no approval needed
  MODERATE,   // Scoped change, requires single approval
  HIGH,       // Sensitive change, requires escalation approval
  CRITICAL    // Production mutation, sandbox-only or requires executive override
}
```

Risk level drives:
- Escalation chains (LOW → MODERATE → HIGH → CRITICAL)
- Approval count requirements
- Notification severity
- Simulation requirements
- Rollback strictness

### 3.3 Governance Evaluation vs Authorization (NORMATIVE)

Critical separation: evaluation is reasoning, authorization is permission.

```typescript
interface GovernanceEvaluation {
  // Policy reasoning
  decision: Decision
  risk_level: RiskLevel
  matched_policy_ids: string[]
  reasons: string[]
  
  // Schema versioning for replay
  decision_schema_version: string
  policy_schema_version: string
  
  // Metadata
  evaluation_id: string
  trace_id: string
  created_at: string
}

interface ExecutionAuthorization {
  // Permission grant
  authorized: boolean
  authorization_id: string
  
  // Authority
  authorized_by: string  // actor who approved
  authorized_at: string
  
  // Scope limits
  approval_scope: string[]
  
  // Temporal constraints
  expires_at?: string  // TTL for approval
  
  // Revocation
  revoked: boolean
  revoked_at?: string
  revocation_reason?: string
  
  // Replay protection
  nonce: string
  execution_token: string
  authorization_signature: string  // signed hash of auth + nonce
  
  // Schema versioning
  authorization_schema_version: string
}
```

**Why this separation matters**:
- Evaluations can repeat (same action, same policy context)
- Authorizations are discrete (granted once, expires/revokes)
- Evaluations inform approvals (policy reasoning)
- Authorizations gate execution (permission boundary)
- Later, evaluations may be cached; authorizations never cached

### 3.4 Governance Decision Result (NORMATIVE)

Every governance decision MUST return this structure:

```typescript
interface GovernanceDecision {
  // Decision verdict
  decision: Decision
  risk_level: RiskLevel
  
  // Unique decision identifier (for audit trail)
  decision_id: string
  
  // Schema versioning (for audit replay and migration)
  decision_schema_version: string
  policy_schema_version: string
  
  // Request tracing
  trace_id: string
  correlation_id: string
  causation_id?: string  // parent action, if any
  
  // Actor information
  actor_id: string
  actor_type: "human" | "agent" | "service"
  
  // Execution context
  environment: string  // "sandbox" | "production"
  action: string       // "SAVE_SPLUNK_CONFIG", "EXECUTE_REMEDIATION", etc.
  resource: string     // What is being governed
  
  // Policy evaluation
  matched_policy_ids: string[]
  policy_snapshot_hash: string
  
  // Explanation (for operators and agents)
  reasons: string[]  // Why this decision was made
  
  // Enforcement semantics
  enforcement_mode: 
    | "hard-block"          // Reject with error
    | "soft-block"          // Warn, allow user override
    | "approval-required"   // Queue for approval
    | "simulation"          // Dry-run mode
  
  // Time constraints
  created_at: string  // ISO 8601
  expires_at?: string // Decision TTL (some decisions expire)
  
  // Authorization (if approval required)
  required_authorization?: ExecutionAuthorization
}
```

**Example: Production URL rejected in sandbox**

```json
{
  "decision": "DENY",
  "decision_id": "decision-556e8f22-9d8e-4a3c-9f27-c4b9d0e8e3b1",
  "trace_id": "trace-abc123",
  "correlation_id": "workflow-789",
  "actor_id": "agent-splunk-config",
  "actor_type": "agent",
  "environment": "sandbox",
  "action": "SAVE_SPLUNK_CONFIG",
  "resource": "splunk:config:45.76.167.6:8089",
  "matched_policy_ids": ["policy-sandbox-isolation-1"],
  "policy_snapshot_hash": "policy-snap-xyz789",
  "reasons": [
    "Production IP (45.76.167.6) is blocked in sandbox environment",
    "Only approved sandbox IP (144.202.48.85) is permitted"
  ],
  "enforcement_mode": "hard-block",
  "created_at": "2026-05-28T10:15:23.456Z"
}
```

---

## 4. Correlation Fabric

### 4.1 Required Identifiers (MANDATORY)

Every governance operation MUST propagate these identifiers:

| Identifier | Purpose | Format | Immutable |
|------------|---------|--------|-----------|
| `trace_id` | End-to-end operational trace (root cause analysis) | UUID v4 | Yes |
| `correlation_id` | Related workflow grouping (batch operations) | UUID v4 | Yes |
| `causation_id` | Parent action linkage (approval → execution) | UUID v4 | Yes |

### 4.2 Propagation Requirements (MANDATORY)

Correlation identifiers MUST propagate across:

- ✅ HTTP request headers (`X-Trace-ID`, `X-Correlation-ID`, `X-Causation-ID`)
- ✅ Queue messages (Kafka headers)
- ✅ Async worker jobs (context propagation)
- ✅ Approval workflows (approval → execution link)
- ✅ Retries (same IDs, incremented attempt counter)
- ✅ Rollback operations (reverse causation chain)
- ✅ Database audit logs

**Loss of correlation identifiers is a governance violation.**

Example:
```
User initiates workflow:
  trace_id = "trace-001"
  correlation_id = "workflow-abc"

Agent receives job:
  headers include: trace_id, correlation_id
  
RGE evaluates:
  decision_id references: trace_id, correlation_id
  
Approval workflow:
  approval record references: causation_id (from agent job)
  
Execution:
  plan_id references: causation_id (from approval)
  
Audit log entry:
  includes: trace_id, correlation_id, causation_id
  
Forensic investigation (6 months later):
  grep audit_log for correlation_id
  → reconstructs entire workflow lineage
```

---

## 5. Execution Intent Freezing

### 5.1 Execution Plan Snapshot (MANDATORY)

Before execution is permitted, the operational intent MUST be frozen:

```typescript
interface ExecutionPlan {
  plan_id: string
  
  // Normalized and deterministic
  normalized_actions: NormalizedAction[]
  
  // Deterministic ordering
  action_sequence: number[]
  
  // Resolved targets (no dynamic lookup at execution)
  resolved_targets: {
    [target_id: string]: {
      hostname: string
      environment: string
      authorized_scopes: string[]
    }
  }
  
  // Frozen policy context
  policy_snapshot_hash: string
  policy_version: string
  
  // Frozen approval context
  approval_snapshot: {
    approved_by: string
    approved_at: string
    approval_scope: string[]
    approval_rationale: string
  }
  
  // Integrity hash
  plan_hash: string  // SHA256
  
  // Metadata
  created_at: string
  approved_at: string
}
```

### 5.2 Plan Hash Computation (NORMATIVE)

```typescript
plan_hash = SHA256(
  JSON.stringify({
    normalized_actions: sortCanonical(plan.normalized_actions),
    action_sequence: plan.action_sequence,
    resolved_targets: sortCanonical(plan.resolved_targets),
    policy_snapshot_hash: plan.policy_snapshot_hash,
    approval_snapshot: sortCanonical(plan.approval_snapshot)
  }, null, 0)  // Deterministic serialization
)
```

**Implications**:
- Hash mismatches MUST invalidate execution eligibility
- Any plan mutation invalidates the hash
- Re-approval required if hash changes
- Hash provides forensic integrity verification

Example:
```
Approved plan hash: "abc123xyz789"
Execution begins with hash check: "abc123xyz789" ✓

Mid-execution, target IP changes:
  resolved_targets["server-42"].hostname = "new-ip"
  New hash: "def456uva890"
  
Execution halts:
  Hash mismatch detected
  "abc123xyz789" != "def456uva890"
  
Result:
  GOVERNANCE VIOLATION
  Execution reverted
  Incident logged
```

### 5.3 Replay Protection (MANDATORY)

Every execution request MUST include replay-prevention fields:

```typescript
interface ExecutionRequest {
  plan_id: string
  
  // Replay protection
  nonce: string              // Unique per execution request
  execution_token: string    // Tied to this execution context
  
  // Authorization verification
  authorization_signature: string  // HMAC-SHA256(
                                   //   authorization_id + 
                                   //   nonce + 
                                   //   plan_hash +
                                   //   secret_key
                                   // )
  
  // Metadata
  requested_at: string
  intended_execution_time: string
}
```

**Why replay protection is critical**:
- Same approval hash could be reused (replay attack)
- Without nonce, internal retries become authorization replays
- Signed hash binds authorization to specific execution context
- Prevents: "I approved action X, but system executed X three times"

**Verification at execution time**:
```
1. Retrieve authorization record
2. Recompute signature:
   expected_sig = HMAC-SHA256(
     auth_id + nonce + plan_hash + secret_key
   )
3. Compare with provided signature
4. If mismatch: DENY (possible replay)
5. If match and nonce not used: ALLOW and mark nonce as consumed
6. If nonce already consumed: DENY (explicit replay attempt)
```

---

## 6. Capability Scope Model

### 6.1 Scope Definitions (NORMATIVE)

```typescript
type CapabilityScope =
  // Read operations
  | "splunk:index:read"
  | "splunk:search:execute"
  | "splunk:metrics:read"
  
  // Operational suggestions (no execution)
  | "telemetry:optimize:suggest"
  | "remediation:suggest"
  | "cost:recommend"
  
  // Execution operations
  | "remediation:execute"
  | "config:update"
  | "index:modify"
  
  // Approval operations
  | "approval:request"
  | "approval:review"
  | "approval:override"
```

### 6.2 Scope Enforcement (MANDATORY)

**Invariant**: Agents MUST receive only minimum required scopes.

**Constraints**:
- ❌ Wildcard scopes (`splunk:*`) are prohibited in production
- ❌ Escalation scopes (`approval:override`) require human operator
- ❌ Scope inflation is governance violation
- ✅ Scopes are versioned (can be revoked/modified)
- ✅ Scope usage is audited (every decision logged)

Example:
```
Agent: TelemetryOptimizationAgent
Assigned scopes:
  ✓ "splunk:index:read"
  ✓ "splunk:search:execute"
  ✓ "telemetry:optimize:suggest"

Attempted action: "Execute remediation"
Required scope: "remediation:execute"

RGE decision:
  ✗ DENY
  Reason: Scope "remediation:execute" not assigned
  enforcement_mode: "hard-block"
```

---

## 7. Fail-Closed Bootstrap

### 7.1 Platform Startup Validation (MANDATORY)

Before any autonomous execution is permitted, startup MUST validate:

```typescript
interface BootstrapValidation {
  // Environment
  environment_defined: boolean
  environment_value: "sandbox" | "production"
  
  // Policy engine
  policy_engine_healthy: boolean
  policy_engine_version: string
  policy_engine_last_healthcheck: string
  
  // Governance integrity
  governance_integrity_healthy: boolean
  governance_database_accessible: boolean
  
  // Audit system
  audit_ledger_writable: boolean
  audit_ledger_last_write: string
  
  // Approval system
  approval_service_reachable: boolean
  approval_service_healthcheck: string
  
  // Correlation fabric
  correlation_fabric_initialized: boolean
  correlation_service_endpoint: string
}
```

**Startup failure sequence**:

```
Platform startup:

1. Validate environment variable exists
   If missing:
     → Disable autonomous execution
     → Log CRITICAL
     → Alert operator

2. Validate policy engine accessible
   If unreachable:
     → Disable autonomous execution
     → Log CRITICAL
     → Alert operator

3. Validate audit ledger writable
   If read-only or unavailable:
     → Disable autonomous execution
     → Log CRITICAL
     → Alert operator

4. Validate approval service reachable
   If unavailable:
     → Disable autonomous execution
     → Log CRITICAL
     → Alert operator

5. Validate correlation fabric initialized
   If uninitialized:
     → Disable autonomous execution
     → Log CRITICAL
     → Alert operator

If any validation fails:
  autonomous_execution_enabled = false
  
Operator must manually investigate and restart platform.
```

---

## 8. Governance Audit Model

### 8.1 Audit Event (NORMATIVE)

Every governance decision MUST emit an immutable audit event:

```typescript
interface GovernanceAuditEvent {
  // Event identity
  audit_id: string
  event_type: string  // "POLICY_EVALUATION" | "APPROVAL_GRANTED" | "EXECUTION_STARTED"
  
  // Tracing
  trace_id: string
  correlation_id: string
  causation_id?: string
  
  // Actor
  actor_id: string
  actor_type: "human" | "agent" | "service"
  actor_authorization_level: string
  
  // Governance decision
  decision: Decision
  decision_id: string
  matched_policy_ids: string[]
  policy_snapshot_hash: string
  
  // Action details
  action: string
  resource: string
  environment: string
  
  // Execution details
  execution_status: "pending" | "executing" | "completed" | "failed" | "rolled_back"
  execution_plan_hash?: string
  
  // Timestamps
  created_at: string
  execution_started_at?: string
  execution_completed_at?: string
  
  // Context
  request_context: { [key: string]: any }
  governance_context: { [key: string]: any }
}
```

### 8.2 Audit Storage (MANDATORY)

- ✅ Events are **append-only** (no updates, no deletes)
- ✅ Events are **immutable** (hash-verified)
- ✅ Events are **timestamped** (NTP synchronized)
- ✅ Events are **traceable** (correlation IDs)
- ✅ Events are **queryable** (by actor, resource, decision type)
- ❌ Events CANNOT be deleted
- ❌ Events CANNOT be modified
- ❌ Events CANNOT expire

---

## 9. Governance Test Strategy

### 9.1 Test Categories (MANDATORY)

| Category | Purpose | Minimum Tests |
|----------|---------|----------------|
| **Determinism** | Same inputs → same outputs | 5 tests |
| **Fail-Closed** | Missing dependencies disable execution | 4 tests |
| **Scope Enforcement** | Unauthorized scopes denied | 3 tests |
| **Correlation Propagation** | IDs preserved across boundaries | 3 tests |
| **Hash Integrity** | Plan mutations rejected | 2 tests |
| **Approval Workflows** | Single/escalation/override paths work | 2 tests |
| **Sandbox Isolation** | Production execution impossible in sandbox | 2 tests |
| **Audit Coverage** | All decisions logged | 2 tests |

**Minimum total**: 23 integration tests + 10 unit tests + 5 execution-integrity tests

### 9.2 Example: Determinism Test

```typescript
describe("Determinism: Same inputs → same decision", () => {
  it("should return identical decisions for identical requests", () => {
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      resource: "splunk:config:45.76.167.6:8089",
      environment: "sandbox",
      policy_snapshot_hash: "abc123"
    }
    
    const decision1 = rge.evaluate(request)
    const decision2 = rge.evaluate(request)
    const decision3 = rge.evaluate(request)
    
    expect(decision1.decision).toBe(Decision.DENY)
    expect(decision2.decision).toBe(Decision.DENY)
    expect(decision3.decision).toBe(Decision.DENY)
    
    expect(decision1.decision_id).toBe(decision2.decision_id)
    expect(decision2.decision_id).toBe(decision3.decision_id)
  })
})
```

### 9.3 Example: Fail-Closed Test

```typescript
describe("Fail-Closed: Missing dependencies disable execution", () => {
  it("should disable execution if governance engine unavailable", async () => {
    rge.engine.health = "unavailable"
    
    const result = await platform.executeAction({
      action: "EXECUTE_REMEDIATION",
      plan_id: "plan-123"
    })
    
    expect(result.execution_enabled).toBe(false)
    expect(result.reason).toContain("governance engine")
  })
})
```

---

## 10. Initial File Structure

```
core/
├── governance/
│   ├── engine/
│   │   ├── runtime-governance-engine.ts
│   │   ├── decision-evaluator.ts
│   │   └── policy-evaluator.ts
│   │
│   ├── policy/
│   │   ├── policy-store.ts
│   │   ├── policy-snapshot.ts
│   │   └── policies/
│   │       ├── environment-policy.ts
│   │       ├── splunk-target-policy.ts
│   │       └── execution-policy.ts
│   │
│   ├── execution/
│   │   ├── execution-plan.ts
│   │   ├── plan-freezer.ts
│   │   └── plan-validator.ts
│   │
│   ├── approvals/
│   │   ├── approval-engine.ts
│   │   ├── approval-workflow.ts
│   │   └── approval-routes.ts
│   │
│   ├── audit/
│   │   ├── governance-audit-service.ts
│   │   ├── audit-event.ts
│   │   └── audit-ledger.ts
│   │
│   ├── correlation/
│   │   ├── correlation-context.ts
│   │   ├── correlation-propagator.ts
│   │   └── correlation-validator.ts
│   │
│   ├── scopes/
│   │   ├── capability-scope.ts
│   │   ├── scope-validator.ts
│   │   └── scope-enforcement.ts
│   │
│   ├── integrity/
│   │   ├── governance-integrity-checker.ts
│   │   └── hash-validator.ts
│   │
│   ├── bootstrap/
│   │   ├── bootstrap-validator.ts
│   │   └── fail-closed-enforcement.ts
│   │
│   └── index.ts
```

---

## 11. Non-Goals (Phase 2A)

**Not included in Phase 2A** (deferred to later phases):
- ❌ Autonomous remediation orchestration
- ❌ Distributed rollback choreography
- ❌ Multi-region governance replication
- ❌ External policy DSL
- ❌ Machine-learning-driven policy recommendation
- ❌ Policy conflict resolution
- ❌ Distributed consensus

**Rationale**: Stay operationally grounded. One fully-governed workflow is more valuable than 20 partially-governed abstractions.

---

## 12. Compliance & Violations

### 12.1 Governance Compliance

Non-compliant runtime behaviors:
- ❌ Non-deterministic policy evaluation
- ❌ Execution without fail-closed checks
- ❌ Mutation of approved plans
- ❌ Loss of correlation IDs
- ❌ Scope violations (action without required scope)
- ❌ Missing audit events
- ❌ Approval bypass

**Response to violation**:
1. Incident MUST be logged with full context
2. Autonomous execution MUST be disabled
3. Operator MUST be alerted
4. Post-incident review MUST be conducted
5. Code change REQUIRED to prevent recurrence

---

## 13. Operational Success Criteria

Phase 2A is complete when:

- ✅ RGE evaluates deterministically (test: 10 identical requests → 10 identical decisions)
- ✅ Fail-closed enforcement works (test: missing policy → execution disabled)
- ✅ Correlation fabric propagates (test: trace IDs preserved across 5+ boundaries)
- ✅ Execution plan freezing enforces immutability (test: hash mismatch → execution halted)
- ✅ Approval workflows route correctly (test: escalation for production resources)
- ✅ Audit ledger captures all decisions (test: no governance decision without audit event)
- ✅ Scope enforcement prevents violations (test: unauthorized scope → DENY)
- ✅ One real governance workflow end-to-end (test: user submits → approval → execution → audit)

---

## Document Change Control

| Version | Date | Change | Author |
|---------|------|--------|--------|
| 1.0 | 2026-05-28 | Initial specification | Architecture Team |

**Next Review**: After Phase 2A skeleton implementation
**Normative Status**: This document supersedes all informal governance discussions

---

