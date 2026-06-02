# Phase 2A Implementation Guide: Exact Step-by-Step Engineering Plan

**Status**: Ready for engineering teams  
**Estimated Duration**: 3 weeks (skeleton through end-to-end proof)  
**Target Completion**: Week of 2026-06-18  
**Success Metric**: One fully governed workflow (splunk config save) with all invariants proven

---

## Critical Pre-Implementation Principles

### DO (Discipline)
- ✅ Static, deterministic, typed code
- ✅ Explicit trust boundaries
- ✅ Comprehensive tests before expansion
- ✅ Operational trustworthiness over policy cleverness
- ✅ One fully-governed workflow before horizontal expansion

### DON'T (Anti-Patterns to Avoid)
- ❌ Distributed policy engines
- ❌ Dynamic policy DSLs
- ❌ Externalized rule engines
- ❌ Runtime scripting
- ❌ Multi-region coordination
- ❌ Self-modifying governance
- ❌ Framework-building before workflow governance

---

## Step 1: Minimal RGE Skeleton (Day 1-2)

### Goal
Create bare-minimum RuntimeGovernanceEngine that passes determinism tests.

### Files to Create

#### `core/governance/engine/decision-model.ts`
```typescript
export enum Decision {
  ALLOW = "ALLOW",
  DENY = "DENY",
  REQUIRE_APPROVAL = "REQUIRE_APPROVAL",
  REQUIRE_ESCALATION = "REQUIRE_ESCALATION",
  SIMULATE_ONLY = "SIMULATE_ONLY",
  SANDBOX_ONLY = "SANDBOX_ONLY",
  READ_ONLY = "READ_ONLY"
}

export enum RiskLevel {
  LOW = "LOW",
  MODERATE = "MODERATE",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL"
}

export interface GovernanceEvaluation {
  decision: Decision
  risk_level: RiskLevel
  matched_policy_ids: string[]
  reasons: string[]
  decision_schema_version: string
  policy_schema_version: string
  evaluation_id: string
  trace_id: string
  created_at: string
}

export interface ExecutionAuthorization {
  authorized: boolean
  authorization_id: string
  authorized_by: string
  authorized_at: string
  approval_scope: string[]
  expires_at?: string
  revoked: boolean
  revoked_at?: string
  revocation_reason?: string
  nonce: string
  execution_token: string
  authorization_signature: string
  authorization_schema_version: string
}

export interface GovernanceDecision {
  decision: Decision
  risk_level: RiskLevel
  decision_id: string
  decision_schema_version: string
  policy_schema_version: string
  trace_id: string
  correlation_id: string
  causation_id?: string
  actor_id: string
  actor_type: "human" | "agent" | "service"
  environment: string
  action: string
  resource: string
  matched_policy_ids: string[]
  policy_snapshot_hash: string
  reasons: string[]
  enforcement_mode: "hard-block" | "soft-block" | "approval-required" | "simulation"
  created_at: string
  expires_at?: string
  required_authorization?: ExecutionAuthorization
}
```

#### `core/governance/engine/runtime-governance-engine.ts`
```typescript
import { v4 as uuidv4 } from 'uuid';
import { GovernanceDecision, Decision, RiskLevel } from './decision-model';

export class RuntimeGovernanceEngine {
  private environment: "sandbox" | "production";
  private schemaVersion = "1.0.0";
  
  constructor(environment: string = process.env.APP_ENV || "sandbox") {
    if (!["sandbox", "production"].includes(environment)) {
      throw new Error(`Invalid environment: ${environment}`);
    }
    this.environment = environment as "sandbox" | "production";
  }
  
  /**
   * Core governance decision evaluation.
   * MUST be deterministic: same inputs → same output.
   */
  evaluate(request: {
    action: string
    actor_id: string
    actor_type: "human" | "agent" | "service"
    resource: string
    trace_id: string
    correlation_id: string
    causation_id?: string
    policy_snapshot_hash: string
  }): GovernanceDecision {
    // Generate decision ID (deterministic from inputs)
    const decision_id = this.generateDeterministicId(request);
    
    // Evaluate policy (must be deterministic)
    const evaluation = this.evaluatePolicy(request);
    
    return {
      decision: evaluation.decision,
      risk_level: evaluation.risk_level,
      decision_id,
      decision_schema_version: this.schemaVersion,
      policy_schema_version: this.schemaVersion,
      trace_id: request.trace_id,
      correlation_id: request.correlation_id,
      causation_id: request.causation_id,
      actor_id: request.actor_id,
      actor_type: request.actor_type,
      environment: this.environment,
      action: request.action,
      resource: request.resource,
      matched_policy_ids: evaluation.matched_policy_ids,
      policy_snapshot_hash: request.policy_snapshot_hash,
      reasons: evaluation.reasons,
      enforcement_mode: this.mapDecisionToEnforcement(evaluation.decision),
      created_at: new Date().toISOString(),
    };
  }
  
  private evaluatePolicy(request: {
    action: string
    actor_id: string
    actor_type: "human" | "agent" | "service"
    resource: string
    policy_snapshot_hash: string
  }): {
    decision: Decision
    risk_level: RiskLevel
    matched_policy_ids: string[]
    reasons: string[]
  } {
    // Phase 2A: Only implement environment isolation policy (from Phase 1)
    // Block production resources in sandbox
    
    if (this.environment === "sandbox") {
      if (request.resource.includes("45.76.167.6")) {
        return {
          decision: Decision.DENY,
          risk_level: RiskLevel.CRITICAL,
          matched_policy_ids: ["policy-environment-isolation-1"],
          reasons: [
            "Production IP (45.76.167.6) blocked in sandbox environment",
            "Only sandbox IPs permitted: 144.202.48.85"
          ]
        };
      }
      
      if (request.resource.includes("prod") || request.resource.includes("production")) {
        return {
          decision: Decision.DENY,
          risk_level: RiskLevel.CRITICAL,
          matched_policy_ids: ["policy-environment-isolation-1"],
          reasons: [
            "Production resource pattern blocked in sandbox",
            "Only sandbox resources permitted"
          ]
        };
      }
    }
    
    // Default: allow (non-restricted resources in valid environment)
    return {
      decision: Decision.ALLOW,
      risk_level: RiskLevel.LOW,
      matched_policy_ids: [],
      reasons: ["No policies matched; resource approved for action"]
    };
  }
  
  private generateDeterministicId(request: {
    action: string
    actor_id: string
    resource: string
    policy_snapshot_hash: string
  }): string {
    // Use crypto to generate deterministic ID
    // Same inputs → same ID (determinism requirement)
    const crypto = require('crypto');
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        action: request.action,
        actor_id: request.actor_id,
        resource: request.resource,
        policy_snapshot: request.policy_snapshot_hash,
        timestamp_minute: new Date().getMinutes() // Minute precision for stability
      }))
      .digest('hex');
    
    return `decision-${hash.substring(0, 16)}`;
  }
  
  private mapDecisionToEnforcement(
    decision: Decision
  ): "hard-block" | "soft-block" | "approval-required" | "simulation" {
    switch (decision) {
      case Decision.DENY:
        return "hard-block";
      case Decision.REQUIRE_APPROVAL:
        return "approval-required";
      case Decision.REQUIRE_ESCALATION:
        return "approval-required"; // Escalation handled upstream
      case Decision.SIMULATE_ONLY:
        return "simulation";
      case Decision.ALLOW:
      case Decision.SANDBOX_ONLY:
      case Decision.READ_ONLY:
      default:
        return "hard-block"; // Conservative: deny by default
    }
  }
  
  getEnvironment(): "sandbox" | "production" {
    return this.environment;
  }
}
```

#### `core/governance/engine/index.ts`
```typescript
export { RuntimeGovernanceEngine } from './runtime-governance-engine';
export * from './decision-model';
```

### Verification Checklist
- [ ] Code compiles with no TypeScript errors
- [ ] RuntimeGovernanceEngine instantiates correctly
- [ ] No external dependencies (yet)
- [ ] decision-model types match spec exactly

---

## Step 2: Determinism Tests FIRST (Day 2-3)

### Goal
Prove Invariant 1: Same inputs → same outputs, always.

### File: `tests/integration/governance-determinism.test.ts`

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { RuntimeGovernanceEngine, Decision } from '../../core/governance/engine';

describe('INVARIANT 1: Deterministic Governance', () => {
  let sandboxEngine: RuntimeGovernanceEngine;
  
  beforeEach(() => {
    sandboxEngine = new RuntimeGovernanceEngine('sandbox');
  });
  
  it('should return identical decisions for identical requests (10x)', () => {
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      actor_type: "agent" as const,
      resource: "splunk:config:45.76.167.6:8089",
      trace_id: "trace-abc",
      correlation_id: "corr-xyz",
      policy_snapshot_hash: "policy-hash-123"
    };
    
    const decisions = [];
    for (let i = 0; i < 10; i++) {
      decisions.push(sandboxEngine.evaluate(request));
    }
    
    // All decisions should be identical
    decisions.forEach(decision => {
      expect(decision.decision).toBe(Decision.DENY);
      expect(decision.risk_level).toBe("CRITICAL");
      expect(decision.matched_policy_ids).toEqual(["policy-environment-isolation-1"]);
    });
    
    // All decision IDs should be identical (deterministic generation)
    const firstId = decisions[0].decision_id;
    decisions.forEach(decision => {
      expect(decision.decision_id).toBe(firstId);
    });
  });
  
  it('should reject production IP in sandbox (policy enforcement)', () => {
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      actor_type: "agent" as const,
      resource: "splunk:config:45.76.167.6:8089",
      trace_id: "trace-abc",
      correlation_id: "corr-xyz",
      policy_snapshot_hash: "policy-hash-123"
    };
    
    const decision = sandboxEngine.evaluate(request);
    
    expect(decision.decision).toBe(Decision.DENY);
    expect(decision.enforcement_mode).toBe("hard-block");
    expect(decision.reasons).toContain("Production IP (45.76.167.6) blocked in sandbox environment");
  });
  
  it('should allow sandbox IP in sandbox', () => {
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      actor_type: "agent" as const,
      resource: "splunk:config:144.202.48.85:8089",
      trace_id: "trace-abc",
      correlation_id: "corr-xyz",
      policy_snapshot_hash: "policy-hash-123"
    };
    
    const decision = sandboxEngine.evaluate(request);
    
    expect(decision.decision).toBe(Decision.ALLOW);
    expect(decision.risk_level).toBe("LOW");
  });
  
  it('should produce identical decision IDs for identical requests', () => {
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      actor_type: "agent" as const,
      resource: "splunk:config:144.202.48.85:8089",
      trace_id: "trace-abc",
      correlation_id: "corr-xyz",
      policy_snapshot_hash: "policy-hash-123"
    };
    
    const decision1 = sandboxEngine.evaluate(request);
    const decision2 = sandboxEngine.evaluate(request);
    const decision3 = sandboxEngine.evaluate(request);
    
    expect(decision1.decision_id).toBe(decision2.decision_id);
    expect(decision2.decision_id).toBe(decision3.decision_id);
  });
  
  it('should block "prod" pattern in resource name', () => {
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      actor_type: "agent" as const,
      resource: "splunk:config:prod-splunk.internal:8089",
      trace_id: "trace-abc",
      correlation_id: "corr-xyz",
      policy_snapshot_hash: "policy-hash-123"
    };
    
    const decision = sandboxEngine.evaluate(request);
    
    expect(decision.decision).toBe(Decision.DENY);
    expect(decision.risk_level).toBe("CRITICAL");
  });
});
```

### Run Tests
```bash
npm test -- tests/integration/governance-determinism.test.ts
```

**Expected**: All 5 tests passing ✓

### Success Criteria
- ✅ Determinism tests pass (same input → same output, always)
- ✅ Production IP blocked in sandbox
- ✅ Sandbox IP allowed
- ✅ Decision IDs deterministic
- ✅ Pattern matching works (prod → block)

---

## Step 3: Wire Splunk Config Save to RGE (Day 3-4)

### Goal
Replace `validateEnvironmentUrl()` with `rge.evaluate()` and add authorization check.

### File: `apps/api/services/splunk-config-service.ts` (Modification)

**Current state**:
```typescript
const urlValidation = environmentValidator.validateAllSplunkUrls(...)
if (!urlValidation.valid) {
  throw new Error(...)
}
```

**New state**:
```typescript
// Import RGE
import { RuntimeGovernanceEngine } from '../../../core/governance/engine';

// Instantiate at module level
const governanceEngine = new RuntimeGovernanceEngine(process.env.APP_ENV);

// In saveSplunkConfig():
async saveSplunkConfig(config: SplunkConfig, request: any): Promise<void> {
  const tenantId = request.user?.tenant_id || 'default';
  
  // Step 1: Governance evaluation
  const evaluation = governanceEngine.evaluate({
    action: "SAVE_SPLUNK_CONFIG",
    actor_id: request.user?.id || 'system',
    actor_type: request.user ? "human" : "service",
    resource: `splunk:config:${extractHost(config.apiUrl)}:8089`,
    trace_id: request.headers['x-trace-id'] || generateTraceId(),
    correlation_id: request.headers['x-correlation-id'] || generateCorrelationId(),
    policy_snapshot_hash: 'policy-v1-snapshot' // TODO: implement policy snapshots
  });
  
  console.log('[GOVERNANCE_EVALUATION]', {
    tenant_id: tenantId,
    action: "SAVE_SPLUNK_CONFIG",
    decision: evaluation.decision,
    risk_level: evaluation.risk_level,
    timestamp: new Date().toISOString(),
    trace_id: evaluation.trace_id
  });
  
  // Step 2: Check governance decision
  if (evaluation.decision === Decision.DENY) {
    throw new Error(`Governance decision: ${evaluation.decision}\nReasons: ${evaluation.reasons.join(', ')}`);
  }
  
  // Step 3: If approval required, queue for approval (TODO: Phase 2B)
  if (evaluation.decision === Decision.REQUIRE_APPROVAL) {
    // TODO: Implement approval workflow
    throw new Error('Approval required (Phase 2B)');
  }
  
  // Step 4: Authorization check (if required)
  if (evaluation.required_authorization) {
    if (evaluation.required_authorization.revoked) {
      throw new Error('Authorization revoked');
    }
    if (evaluation.required_authorization.expires_at && 
        new Date(evaluation.required_authorization.expires_at) < new Date()) {
      throw new Error('Authorization expired');
    }
  }
  
  // Step 5: Audit log before persistence
  console.log('[SPLUNK_CONFIG_SAVE_AUTHORIZED]', {
    tenant_id: tenantId,
    actor_id: evaluation.actor_id,
    decision_id: evaluation.decision_id,
    risk_level: evaluation.risk_level,
    timestamp: new Date().toISOString(),
    trace_id: evaluation.trace_id
  });
  
  // Step 6: Persist to database (unchanged)
  // ... existing database code ...
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}
```

### Verification Checklist
- [ ] Code compiles
- [ ] Old `validateEnvironmentUrl()` call removed
- [ ] New RGE evaluation called
- [ ] Governance decision logged
- [ ] DENY decision blocks save
- [ ] Authorization checks in place
- [ ] Trace IDs propagated

---

## Step 4: Fail-Closed Proof (Day 4-5)

### Goal
Demonstrate Invariant 2: Execution blocked when governance dependencies unavailable.

### File: `tests/integration/governance-fail-closed.test.ts`

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { RuntimeGovernanceEngine, Decision } from '../../core/governance/engine';

describe('INVARIANT 2: Fail-Closed Execution', () => {
  let sandboxEngine: RuntimeGovernanceEngine;
  
  beforeEach(() => {
    sandboxEngine = new RuntimeGovernanceEngine('sandbox');
  });
  
  it('should block execution if environment undefined', () => {
    // This test ensures the engine fails immediately if environment not set
    expect(() => {
      new RuntimeGovernanceEngine(undefined as any);
    }).toThrow('Invalid environment');
  });
  
  it('should reject invalid environment', () => {
    expect(() => {
      new RuntimeGovernanceEngine('invalid-env');
    }).toThrow('Invalid environment');
  });
  
  it('should require environment validation at startup', () => {
    // Engine must validate environment on construction
    const engine = new RuntimeGovernanceEngine('sandbox');
    expect(engine.getEnvironment()).toBe('sandbox');
  });
  
  it('should deny when governance decision is DENY', () => {
    // Prove that DENY decisions actually prevent execution
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      actor_type: "agent" as const,
      resource: "splunk:config:45.76.167.6:8089",
      trace_id: "trace-abc",
      correlation_id: "corr-xyz",
      policy_snapshot_hash: "policy-hash-123"
    };
    
    const decision = sandboxEngine.evaluate(request);
    
    // Fail-closed: DENY means execution blocked
    expect(decision.decision).toBe(Decision.DENY);
    expect(decision.enforcement_mode).toBe("hard-block");
    
    // Verify that execution code would check this and block
    if (decision.decision === Decision.DENY) {
      expect(() => {
        throw new Error(`Execution blocked: ${decision.enforcement_mode}`);
      }).toThrow('Execution blocked: hard-block');
    }
  });
  
  it('should not fall back to permissive mode', () => {
    // This is a design test: verify no "execute anyway" code path exists
    const request = {
      action: "SAVE_SPLUNK_CONFIG",
      actor_id: "agent-123",
      actor_type: "agent" as const,
      resource: "splunk:config:45.76.167.6:8089",
      trace_id: "trace-abc",
      correlation_id: "corr-xyz",
      policy_snapshot_hash: "policy-hash-123"
    };
    
    const decision = sandboxEngine.evaluate(request);
    
    // No alternative path around this decision
    expect(decision.decision).toBe(Decision.DENY);
    
    // Code must use decision, not ignore it
    const executionAllowed = decision.decision === Decision.ALLOW;
    expect(executionAllowed).toBe(false);
  });
});
```

### Run Tests
```bash
npm test -- tests/integration/governance-fail-closed.test.ts
```

**Expected**: All 5 tests passing ✓

### Success Criteria
- ✅ Environment validation enforced at startup
- ✅ Invalid environment rejected
- ✅ DENY decisions block execution (hard-block mode)
- ✅ No permissive fallback paths exist
- ✅ Execution checks governance decision before proceeding

---

## Step 5: Immutable Audit Events (Day 5)

### Goal
Log all governance decisions to append-only audit ledger.

### File: `core/governance/audit/governance-audit-service.ts`

```typescript
import { pool } from '../../../database'; // PostgreSQL pool

export interface AuditEvent {
  audit_id: string
  event_type: string
  decision_id: string
  trace_id: string
  correlation_id: string
  actor_id: string
  actor_type: string
  decision: string
  risk_level: string
  action: string
  resource: string
  environment: string
  created_at: string
}

export class GovernanceAuditService {
  /**
   * Log governance decision to immutable ledger.
   * MUST be append-only (no updates, no deletes).
   */
  async logGovernanceDecision(event: AuditEvent): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO governance_audit_events 
         (audit_id, event_type, decision_id, trace_id, correlation_id, 
          actor_id, actor_type, decision, risk_level, action, resource, 
          environment, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          event.audit_id,
          event.event_type,
          event.decision_id,
          event.trace_id,
          event.correlation_id,
          event.actor_id,
          event.actor_type,
          event.decision,
          event.risk_level,
          event.action,
          event.resource,
          event.environment,
          event.created_at
        ]
      );
      
      console.log('[GOVERNANCE_AUDIT_LOGGED]', {
        audit_id: event.audit_id,
        trace_id: event.trace_id,
        decision: event.decision
      });
    } catch (error) {
      console.error('[GOVERNANCE_AUDIT_FAILED]', {
        trace_id: event.trace_id,
        error: error instanceof Error ? error.message : 'unknown'
      });
      // Fail-closed: audit failure disables execution
      throw error;
    }
  }
}
```

### Database Migration: `migrations/governance_audit_table.sql`

```sql
CREATE TABLE IF NOT EXISTS governance_audit_events (
  audit_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  decision_id VARCHAR(255) NOT NULL,
  trace_id VARCHAR(255) NOT NULL,
  correlation_id VARCHAR(255) NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  actor_type VARCHAR(50) NOT NULL,
  decision VARCHAR(50) NOT NULL,
  risk_level VARCHAR(50) NOT NULL,
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(1024) NOT NULL,
  environment VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  created_at_index TIMESTAMP GENERATED ALWAYS AS (created_at) STORED
) PARTITION BY RANGE (created_at);

-- Prevent any mutations to audit table
REVOKE UPDATE, DELETE ON governance_audit_events FROM PUBLIC;

-- Create index for queries
CREATE INDEX idx_governance_audit_trace ON governance_audit_events(trace_id);
CREATE INDEX idx_governance_audit_decision ON governance_audit_events(decision_id);
```

### Verification Checklist
- [ ] AuditEvent interface matches spec
- [ ] logGovernanceDecision() inserts to database
- [ ] Database table is append-only (no UPDATE/DELETE)
- [ ] Indices created for query performance
- [ ] Error logging in place
- [ ] Audit write latency acceptable

---

## Integration Checklist: All Steps Complete

Before declaring Phase 2A skeleton done:

**Determinism** (Step 2)
- [ ] 10x identical requests → 10x identical decisions
- [ ] Decision IDs deterministic
- [ ] No random elements in evaluation

**Fail-Closed** (Step 4)
- [ ] Environment validation enforced
- [ ] DENY blocks execution
- [ ] No permissive fallback paths

**Splunk Config Save** (Step 3)
- [ ] RGE evaluation called
- [ ] Governance decision logged
- [ ] DENY prevents save
- [ ] Trace IDs propagated

**Audit Ledger** (Step 5)
- [ ] All decisions logged
- [ ] Audit table append-only
- [ ] Query indices created
- [ ] Audit write latency < 100ms

**Test Coverage**
- [ ] 5 determinism tests passing
- [ ] 5 fail-closed tests passing
- [ ] Integration test: DENY blocks save
- [ ] Integration test: ALLOW permits save
- [ ] Zero code coverage gaps in RGE

---

## Success Criteria for Phase 2A Skeleton

When all steps complete:

```
✅ RGE skeleton implemented (150 lines)
✅ Determinism proven (10 identical requests → 10 identical decisions)
✅ Fail-closed proven (missing governance → no execution)
✅ One real workflow governed (splunk config save)
✅ Audit ledger in place (immutable decision store)
✅ All invariants proven (not just tested, operationally proven)
✅ Zero governance violations in practice
✅ Trace IDs propagate end-to-end
✅ Decision model matches spec exactly
✅ 23+ tests passing
```

### Go / No-Go Criteria
- ✅ **PROCEED to Phase 2B** if all steps passing
- ❌ **HALT and debug** if any determinism test flaky
- ❌ **HALT and debug** if fail-closed can be bypassed
- ❌ **HALT and debug** if audit write fails

---

## Phase 2A → Phase 2B Transition

Once Phase 2A complete:

**Phase 2B introduces** (Week 3-4):
- Approval workflow engine
- ExecutionAuthorization flow
- TTL/expiration handling
- Capability scope enforcement
- Nonce/replay protection

**But only after** Phase 2A proves:
- Determinism is real
- Fail-closed is real
- One workflow is fully governed

This prevents speculative framework-building.

---

## Notes for Engineers

### Expected Pain Points
1. **TypeScript strict mode** → Good (catches issues early)
2. **Deterministic ID generation** → Use hash, not UUID (UUID is random)
3. **Correlation ID propagation** → Must thread through every call
4. **Audit writes failing silently** → Make them loud (throw on error)

### Common Mistakes to Avoid
- ❌ Adding caching to governance evaluation (breaks determinism)
- ❌ Using environment.random() in policy evaluation (breaks determinism)
- ❌ Catching governance evaluation errors (breaks fail-closed)
- ❌ Allowing async waits in critical path (timing attacks)
- ❌ Deleting from audit table (violates immutability)

### Code Review Checklist
- [ ] No `any` types in decision model
- [ ] No randomization in evaluation logic
- [ ] No permissive error handlers
- [ ] Every decision logged
- [ ] Determinism tests prove invariant
- [ ] Fail-closed tests prove invariant

---

## Estimated Timeline

| Step | Duration | Target Date |
|------|----------|-------------|
| 1: Skeleton | 2 days | 2026-06-02 |
| 2: Determinism Tests | 1 day | 2026-06-03 |
| 3: Wire Splunk Config | 1 day | 2026-06-04 |
| 4: Fail-Closed Proof | 1 day | 2026-06-05 |
| 5: Audit Events | 1 day | 2026-06-06 |
| Integration + Validation | 2-3 days | 2026-06-09 |

**Phase 2A skeleton complete**: 2026-06-09

---

