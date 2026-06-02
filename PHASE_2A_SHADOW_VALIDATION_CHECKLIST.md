# Phase 2A Shadow Validation Checklist

**Status**: Integration In Progress  
**Date**: 2026-05-28  
**Goal**: Complete integration of governance infrastructure for shadow mode monitoring

---

## Architecture Components (All Complete ✅)

### Core Governance Infrastructure
- ✅ **governance-mode.ts** — Feature flag control (5 modes)
- ✅ **governance-metrics.ts** — Metric collection and drift reports
- ✅ **governance-integrity.ts** — Health checks (7 criteria, wired to metrics)
- ✅ **governance-observer.ts** — Continuous monitoring service
- ✅ **NORMALIZATION_CONTRACT.md** — Frozen semantics
- ✅ **PHASE_2A_STAGED_ENFORCEMENT_ROADMAP.md** — Stage progression strategy

---

## Integration Checklist (Must Complete Before Shadow Validation)

### Phase 2A.1: Metrics Recording Wiring

**Requirement**: Governance evaluation must record metrics for every decision.

**Current Status**: Partial (semantic logging exists, metrics recording needs wiring)

**Action Items**:

```
[ ] Update governance engine evaluation() function:
    - After decision evaluation:
      recordGovernanceDecision(decision, riskLevel, action, environment, latencyMs)
    
[ ] Update shadow mode comparison:
    - If RGE decision !== old validator decision:
      recordClassifiedMismatch(type, rgeDecision, oldValidatorDecision, environment)
    - Else:
      recordShadowConsensusMatch(environment)

[ ] Update error handling:
    - On evaluation exception:
      recordGovernanceEvaluationFailure(reason, environment)

[ ] Verify metrics are recorded BEFORE enforcement check:
    - Metrics must reflect actual runtime behavior
    - Should not count hypothetical denials twice
```

**Implementation Location**: `apps/api/services/governance-engine.ts` or evaluation core

### Phase 2A.2: Observer Service Initialization

**Requirement**: Governance observer must start on application startup.

**Current Status**: Code ready, needs wiring to startup

**Action Items**:

```
[ ] Add to application startup sequence:
    import { initializeGovernanceObserver } from '../core/governance/governance-observer';
    
    on_startup: {
      initializeGovernanceObserver();
      console.log('[APP_STARTUP] Governance observer initialized');
    }

[ ] Add to graceful shutdown:
    import { shutdownGovernanceObserver } from '../core/governance/governance-observer';
    
    on_shutdown: {
      shutdownGovernanceObserver();
      console.log('[APP_SHUTDOWN] Governance observer stopped');
    }

[ ] Verify observer logs appear in application logs every 5 minutes:
    [GOVERNANCE_OBSERVATION_STATE] with current state
    [GOVERNANCE_DRIFT_REPORT] with metrics summary
    [GOVERNANCE_INTEGRITY_CHECK] with health status
```

**Implementation Location**: Application startup code (main.ts, app.ts, server.ts, etc.)

### Phase 2A.3: Environment Variable Configuration

**Requirement**: APP_GOVERNANCE_MODE must be configurable and logged.

**Current Status**: Feature flag implemented, needs env wiring

**Action Items**:

```
[ ] Ensure .env.example contains:
    APP_GOVERNANCE_MODE=SHADOW  # Stage progression: SHADOW → ENFORCING_LOG_ONLY → ...

[ ] Add to Docker environment for testing:
    ENV APP_GOVERNANCE_MODE=SHADOW

[ ] Verify on startup:
    [GOVERNANCE_MODE_STARTUP] logs current mode and enablement

[ ] Create environment-specific configurations:
    - sandbox: SHADOW (always, for safety)
    - staging: ENFORCING_LOG_ONLY (for canary validation)
    - production: FULL_ENFORCING (after gates passed)
```

**Implementation Location**: Environment configuration and startup logging

### Phase 2A.4: Governance Status Endpoint (Optional but Recommended)

**Requirement**: Operators need visibility into governance state without parsing logs.

**Current Status**: Observer service provides data, needs HTTP endpoint

**Action Items**:

```
[ ] Create GET /governance/status endpoint:
    Returns GovernanceObservationState {
      mode: string
      observation_window_start: ISO timestamp
      cumulative_evaluations: number
      cumulative_mismatches: number
      cumulative_failures: number
      stage_transition_ready: boolean
      stage_transition_reason: string
      latest_integrity_state: HEALTHY | DEGRADED | FAILED
      latest_consensus_rate: number (0-100)
    }

[ ] Create GET /governance/drift-report endpoint:
    Returns latest GovernanceDriftReport {
      window: string
      summary: {...}
      by_action: [...]
      mismatch_types: [...]
      normalization_edge_cases: [...]
    }

[ ] Secure endpoints:
    - Internal network only (no public access)
    - Require admin/operator role
    - Log all accesses
```

**Implementation Location**: `apps/api/routes/governance-status-routes.ts` (new)

### Phase 2A.5: Replay Validation Wiring

**Requirement**: Historical decisions must be replayable under same policy (governance integrity check).

**Current Status**: Skeleton in integrity checks, needs implementation

**Action Items**:

```
[ ] Implement replay validation:
    - Store evaluations with input_fingerprint, policy_hash, decision_hash
    - Periodically replay 10-20 historical requests
    - Compare decision_id:
      - Same input fingerprint + same policy hash = MUST produce same decision
      - Failure = FAILED integrity state (rollback required)

[ ] Wire to governance-integrity.ts:
    replay_validation: {
      status: replay_validation_test_result,
      passed: X,
      failed: Y
    }

[ ] Add to drift reports:
    - Include any replay validation failures
    - Include any normalization edge cases detected
```

**Implementation Location**: `core/governance/governance-replay.ts` (new, if needed)

### Phase 2A.6: Normalization Edge Case Tracking

**Requirement**: Detect and log normalization variations for forensic analysis.

**Current Status**: Skeleton in integrity checks, needs implementation

**Action Items**:

```
[ ] Track normalization variants:
    - When same request produces multiple normalized forms
    - Log variant pairs with input_fingerprint
    - Example: HTTPS://EXAMPLE.COM and https://example.com → same fingerprint

[ ] Wire to drift reports:
    normalization_edge_cases: [
      {
        normalized_resource: string
        variants_seen: number
        input_fingerprint: string
      }
    ]

[ ] Alert on novel variants:
    - If new normalization variant detected
    - Log [NORMALIZATION_VARIANCE_DETECTED]
    - May indicate normalization bug or attack pattern
```

**Implementation Location**: `core/governance/governance-metrics.ts` (extend) or new module

### Phase 2A.7: Audit Health Monitoring

**Requirement**: Governance decisions must be audited; audit write failures are critical.

**Current Status**: Skeleton in integrity checks, needs implementation

**Action Items**:

```
[ ] Wire audit write failure tracking:
    - Each governance decision written to audit log
    - Track failures to write (disk full, permission denied, etc.)
    - Include in integrity checks:
      audit_health: {
        status: (failures === 0) ? 'pass' : 'fail',
        write_failures: number
      }

[ ] Action on audit write failure:
    - Log [GOVERNANCE_AUDIT_WRITE_FAILED]
    - Increment governance_audit_write_failures counter
    - If integrity check shows audit failures: DEGRADED or FAILED state
```

**Implementation Location**: Governance evaluation + audit module

---

## Stage 1: SHADOW Mode Readiness (Days 1-2)

### Pre-Launch Checklist

```
[ ] Code Integration Complete
    [ ] Metrics recording wired to evaluation
    [ ] Observer service initializes on startup
    [ ] Environment variable APP_GOVERNANCE_MODE=SHADOW
    [ ] Status endpoint available (optional)

[ ] Testing
    [ ] Unit tests for governance-mode.ts (all modes work)
    [ ] Unit tests for governance-metrics.ts (counters, latencies)
    [ ] Unit tests for governance-integrity.ts (health evaluation)
    [ ] Integration test: SHADOW mode → 10 requests → metrics recorded
    [ ] Integration test: Observer generates drift report
    [ ] Integration test: Stage transition readiness evaluates correctly

[ ] Deployment
    [ ] Docker image built with APP_GOVERNANCE_MODE=SHADOW
    [ ] Logs configuration captures [GOVERNANCE_*] lines
    [ ] Sandbox environment ready for shadow monitoring
    [ ] No enforcement (old validator still authoritative)

[ ] Operator Preparation
    [ ] Documentation on monitoring shadow mode
    [ ] Example log lines to watch for
    [ ] How to check if shadow gates have been met
    [ ] How to request stage transition to ENFORCING_LOG_ONLY
```

### Shadow Mode Gates (Automatic Check)

```
✅ 100+ representative evaluations
✅ 0 decision mismatches (RGE vs old validator)
✅ 0 evaluation failures
✅ 100% shadow consensus rate
✅ Latency p95 < 5ms
✅ Normalization stable
✅ Replay validation passing
✅ Audit writes succeeding
✅ Operator review complete
→ PROCEED TO STAGE 2
```

---

## Dependencies & Blockers

### Hard Dependencies (Must Complete)
1. ✅ governance-mode.ts (complete)
2. ✅ governance-metrics.ts (complete)
3. ✅ governance-integrity.ts (complete)
4. ✅ governance-observer.ts (complete)
5. ⏳ **Metrics recording wiring** (IN PROGRESS - blocks shadow validation)
6. ⏳ **Observer service initialization** (IN PROGRESS - blocks shadow validation)

### Nice-to-Have (Can Be Added Later)
- Status endpoint (helpful but not required)
- Replay validation automation (can be manual initially)
- Normalization edge case tracking (can be log-based)
- Advanced audit monitoring (can use existing audit logs)

### Known Limitations
- Replay validation currently manual (can be automated in Phase 2A.1)
- Normalization edge cases need explicit tracking (can add in Phase 2A.6)
- Audit health depends on existing audit infrastructure (must verify)

---

## Deployment Timeline

```
Day 1: Code Integration Complete
  ├─ Metrics recording wired
  ├─ Observer service integrated
  ├─ Environment variables configured
  └─ All tests passing

Day 2: Shadow Mode Deployment & Monitoring
  ├─ Deploy to sandbox with APP_GOVERNANCE_MODE=SHADOW
  ├─ Run real traffic (or load test)
  ├─ Collect 100+ evaluations
  ├─ Watch for mismatches (should be 0)
  ├─ Monitor observer logs every 5 minutes
  └─ Verify all gates passing

Day 3: Stage Transition Decision
  ├─ Review drift reports
  ├─ Verify integrity state = HEALTHY
  ├─ Get operator sign-off
  ├─ Stage transition ready → ENFORCING_LOG_ONLY
  └─ (Or rollback if issues found)
```

---

## Log Lines to Monitor (Operator Handbook)

### Startup
```
[GOVERNANCE_MODE_STARTUP] mode: SHADOW, enforcing: false, active: true
[GOVERNANCE_OBSERVER_START] mode: SHADOW, window_start: 2026-05-28T...
```

### Every 5 Minutes
```
[GOVERNANCE_OBSERVATION_STATE] 
  cumulative_evaluations: 124
  cumulative_mismatches: 0
  cumulative_failures: 0
  latest_consensus_rate: 100
  latest_integrity_state: HEALTHY
  stage_transition_ready: true
  stage_transition_reason: "SHADOW gates met: 100+ evals, 0 mismatches, ..."
```

### Hourly (Drift Report)
```
[GOVERNANCE_DRIFT_REPORT]
  window: 1h
  total_evaluations: 245
  mismatches: 0
  evaluation_failures: 0
  shadow_consensus_rate: 100
  avg_latency_ms: 3
  p95_latency_ms: 7
  p99_latency_ms: 12
```

### On Mismatch (Critical)
```
[GOVERNANCE_DECISION] mismatch: true
  rge_decision: DENY
  old_validator_decision: ALLOW
  mismatch_type: POLICY
```

### On Integrity Issue (Critical)
```
[GOVERNANCE_INTEGRITY_CHECK:error]
  state: FAILED
  recommendation: "[CRITICAL] Governance integrity FAILED: 1 check(s) failed. ROLLBACK to SHADOW mode immediately."
  checks:
    evaluation_failures: status: fail (5.2%), threshold: 5%
```

---

## Success Criteria

### Shadow Mode Success (Stage 1 Complete)
- ✅ 100+ evaluations without errors
- ✅ 100% shadow consensus (no mismatches)
- ✅ Latency p95 < 5ms
- ✅ All semantic fields logged
- ✅ Observer generates drift reports
- ✅ Integrity checks passing
- ✅ Operator confident in results
- → Ready for ENFORCING_LOG_ONLY

---

## Next Phase: ENFORCING_LOG_ONLY

Once SHADOW gates are met:

1. Change APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY
2. Restart application
3. Monitor for hypothetical DENYs (violations logged but not enforced)
4. Ensure no unexpected blocking patterns
5. After 1-2 weeks stable: proceed to ENFORCING_NON_CRITICAL
6. After 1+ more weeks stable: proceed to FULL_ENFORCING

---

## Resources

- **PHASE_2A_STAGED_ENFORCEMENT_ROADMAP.md** — Full 4-stage strategy
- **NORMALIZATION_CONTRACT.md** — Frozen semantics for determinism
- **governance-mode.ts** — Feature flag implementation
- **governance-metrics.ts** — Metrics collection and drift reports
- **governance-integrity.ts** — Health checks and gating
- **governance-observer.ts** — Continuous monitoring service

---

## Questions for Operator

1. How will you monitor the [GOVERNANCE_OBSERVATION_STATE] logs?
2. What alert threshold for mismatch rate?
3. Who approves stage transitions?
4. How long will you run SHADOW before proceeding?
5. Do you have load testing capability for representative traffic?

---

## Checklist Summary

```
CRITICAL PATH (Blocks Shadow Validation):
  [ ] Metrics recording wired (metrics.recordGovernanceDecision called)
  [ ] Observer service initializes
  [ ] Environment variable configuration
  [ ] Tests passing

NICE-TO-HAVE (Can Be Added Later):
  [ ] Status endpoint
  [ ] Replay validation automation
  [ ] Normalization edge case tracking
  [ ] Advanced audit health monitoring

DEPLOYMENT READY WHEN:
  All CRITICAL PATH items complete + passing tests + operator approval
```
