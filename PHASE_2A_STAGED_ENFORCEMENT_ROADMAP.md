# Phase 2A: Staged Enforcement Roadmap

**Status**: Architecture Ready for Staged Rollout  
**Date**: 2026-05-28  
**Risk Profile**: Dramatically Reduced (4 stages, not binary cutover)

---

## Why Staged Enforcement

**Traditional Binary Cutover**: SHADOW → ENFORCING (high risk, high blast radius)

**Staged Cutover**: 
```
SHADOW
  ↓ (after 100+ evals, 0 mismatches)
ENFORCING_LOG_ONLY
  ↓ (after 1-2 weeks, stable logs)
ENFORCING_NON_CRITICAL
  ↓ (after non-critical stable)
FULL_ENFORCING
```

**Benefit**: Any unexpected behavior caught at low-risk stage before full enforcement.

---

## Stage 1: SHADOW (Current, Days 1-2)

### Configuration
```bash
export APP_GOVERNANCE_MODE=SHADOW
```

### Behavior
```
Request
  ↓
Run old validator AND RGE in parallel
  ├─ Old validator result → enforced
  └─ RGE result → logged only
  ↓
Execute normally (old validator authoritative)
```

### Telemetry
```
[GOVERNANCE_DECISION] logs with:
- rge_decision: ALLOW
- old_validator_decision: ALLOW
- mismatch: false
- All semantic detail

[GOVERNANCE_DRIFT_REPORT] hourly:
- total_evaluations
- mismatches
- evaluation_failures
- shadow_consensus_rate
- avg_latency_ms
```

### Gates to Pass
```
✅ 100+ representative evaluations
✅ 0 decision mismatches
✅ 0 evaluation failures
✅ shadow_consensus_rate = 100%
✅ avg_latency_ms < 5ms
✅ All semantic fields logged
✅ Operator review complete
```

### Exit Criteria
All 7 gates pass → Proceed to Stage 2

### Rollback
```bash
export APP_GOVERNANCE_MODE=SHADOW  # Stay in shadow
```

---

## Stage 2: ENFORCING_LOG_ONLY (Days 3-7)

### Configuration
```bash
export APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY
```

### Behavior
```
Request
  ↓
Run RGE evaluation
  ├─ Decision computed
  └─ Violations logged (not enforced)
  ↓
Execute normally (RGE internal authority, but no blocking)
```

**Key**: RGE decides, but doesn't enforce yet. Violations visible in logs.

### Telemetry
```
[GOVERNANCE_DECISION] logs:
- rge_decision: evaluated
- enforcement_mode: log_only
- violations logged but not blocking

[GOVERNANCE_DRIFT_REPORT] tracks:
- Hypothetical DENYs (if enforcing)
- Denial reasons
- Actors affected
```

### Gates to Pass
```
✅ No unexpected decision patterns
✅ No hypothetical DENYs on critical paths
✅ Logging proves RGE would agree with old validator
✅ Latency stable
✅ Operator confidence high
```

### What We're Testing
- Does RGE DENY things we don't expect?
- Are DENY reasons correct?
- Would enforcement break business processes?

### Exit Criteria
All gates pass, no surprises → Proceed to Stage 3

### Rollback
```bash
export APP_GOVERNANCE_MODE=SHADOW  # Back to shadow
# Investigate why DENYs unexpected
# Fix policy or normalization
# Return to Stage 2
```

---

## Stage 3: ENFORCING_NON_CRITICAL (Days 8-14)

### Configuration
```bash
export APP_GOVERNANCE_MODE=ENFORCING_NON_CRITICAL
```

### Behavior
```
Request with decision.risk_level
  ↓
if risk_level ∈ [LOW, MODERATE]:
  ├─ DENY/REQUIRE_APPROVAL blocks execution
  └─ Enforcement active (fail-closed)
else if risk_level ∈ [HIGH, CRITICAL]:
  ├─ Decision logged
  └─ Execution allowed (still monitoring)
```

**Key**: Enforce low-risk decisions first; monitor high-risk for 1-2 weeks.

### Telemetry
```
[GOVERNANCE_DECISION] tracks:
- Enforced decisions: LOW, MODERATE
- Logged decisions: HIGH, CRITICAL

Metrics separate:
- enforcement_active_low_moderate: true
- enforcement_active_high_critical: false

Reports show:
- Actual DENYs on LOW/MODERATE (should be 0 in Phase 2A)
- Hypothetical DENYs on HIGH/CRITICAL (logged but not enforced)
```

### Gates to Pass
```
✅ 0 unexpected DENYs on LOW/MODERATE
✅ 0 blocking failures
✅ HIGH/CRITICAL violations understood
✅ Operator confidence remains high
```

### What We're Testing
- Do LOW/MODERATE enforcement cause issues?
- Are HIGH/CRITICAL DENYs as expected?
- Is Phase 2A policy only doing environment isolation (no other DENYs)?

### Exit Criteria
LOW/MODERATE enforcement stable for 1+ week → Proceed to Stage 4

### Rollback
```bash
export APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY  # Back to logging only
# Investigate unexpected blocking
# Fix issues
# Return to Stage 3
```

---

## Stage 4: FULL_ENFORCING (Day 15+)

### Configuration
```bash
export APP_GOVERNANCE_MODE=FULL_ENFORCING
```

### Behavior
```
Request with any risk_level
  ↓
if decision = DENY:
  └─ Block execution (fail-closed)
if decision = REQUIRE_APPROVAL:
  └─ Block execution (Phase 2B gates approval)
if decision = ALLOW:
  └─ Execute normally
```

**Key**: All governance decisions now enforced. No fallback.

### Telemetry
```
Full governance metrics:
- governance_decisions_total (all decisions)
- governance_denials_total (actual blocks)
- governance_evaluation_failures_total (fail-closed)
- governance_evaluation_ms (latency)

Expected for Phase 2A:
- DENYs ≈ 0 (only environment isolation)
- Evaluation failures ≈ 0 (determinism proven)
- Latency p95 < 10ms
```

### Gates to Pass
```
✅ All previous gates still passing
✅ FULL_ENFORCING for 1+ week stable
✅ No unexpected blocks
✅ Evaluation failures = 0
✅ Operator signs off on full enforcement
```

### Permanent Monitoring
```
Daily:
  - governance_denials_total (should be ~0 Phase 2A)
  - governance_evaluation_failures_total (should be 0)
  - governance_evaluation_ms latency (should be <5ms p50, <10ms p95)

Weekly:
  - [GOVERNANCE_DRIFT_REPORT] review
  - Check for normalization edge cases
  - Verify replay consistency
```

### Rollback (Emergency)
```bash
export APP_GOVERNANCE_MODE=ENFORCING_NON_CRITICAL  # Downgrade
# or
export APP_GOVERNANCE_MODE=SHADOW  # Full rollback
# Investigate failure
# Fix root cause
# Proceed through stages again
```

---

## Timeline Example

```
Day 1-2: SHADOW
  ├─ Deploy shadow mode
  ├─ Run real traffic
  ├─ Accumulate 100+ evaluations
  └─ Verify gates: 100+ evals, 0 mismatches, 0 failures

Day 3: Review + Operator Sign-Off
  ├─ Review [GOVERNANCE_DRIFT_REPORT]
  ├─ Analyze decision patterns
  └─ Get operator approval

Day 4-9: ENFORCING_LOG_ONLY (1 week)
  ├─ Deploy logging-only enforcement
  ├─ Run real traffic
  ├─ Monitor hypothetical DENYs
  └─ Verify gates: no surprises, stable logs

Day 10: Review + Operator Sign-Off
  ├─ Review denial patterns
  ├─ Confirm RGE makes sense
  └─ Get approval

Day 11-19: ENFORCING_NON_CRITICAL (1+ week)
  ├─ Deploy selective enforcement (LOW/MODERATE only)
  ├─ Run real traffic
  ├─ Monitor actual enforcement
  └─ Verify gates: 0 unexpected blocks, stable

Day 20: Review + Operator Sign-Off
  ├─ Confirm LOW/MODERATE enforcement works
  ├─ Confirm HIGH/CRITICAL logging understood
  └─ Get approval

Day 21+: FULL_ENFORCING
  ├─ Deploy full enforcement
  ├─ Continuous monitoring
  └─ Monthly operator review
```

---

## Risk Mitigation By Stage

| Risk | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|------|---------|---------|---------|---------|
| Wrong policy | ✅ Logged | ✅ Logged | ⚠️ Blocks LOW/MOD | ❌ Blocks all |
| Normalization bug | ✅ Logged | ✅ Logged | ⚠️ Partial blocks | ❌ Full blocks |
| Latency spike | ✅ Logged | ✅ Logged | ⚠️ Some impact | ❌ Full impact |
| Eval failure | ✅ Logged | ✅ Logged | ⚠️ Some fail-closed | ❌ Full fail-closed |
| Unexpected DENY | ✅ Visible | ✅ Visible | ⚠️ Blocks non-critical | ❌ Blocks critical |

**Key**: Each stage exposes more blast radius only after proving safety.

---

## Governance Integrity State Gates

Each stage transition requires:

```typescript
const check = checkGovernanceIntegrity();

if (check.state === GovernanceIntegrityState.HEALTHY) {
  // Safe to proceed
  advanceToNextStage();
} else if (check.state === GovernanceIntegrityState.DEGRADED) {
  // Investigate before proceeding
  investigateAndFix();
  return;
} else {
  // FAILED: Immediate rollback
  rollbackToShadow();
  throw new Error("Governance integrity check failed");
}
```

---

## Emergency Procedures

### Downgrade from ENFORCING_NON_CRITICAL → ENFORCING_LOG_ONLY
```bash
# Step 1: Set mode
export APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY

# Step 2: Restart services

# Step 3: Verify in logs
grep '[GOVERNANCE_DECISION]' logs/*.json | jq '.enforcement_mode'
# Should show: "log_only" only

# Step 4: Alert team
# Create incident: "Downgraded governance to ENFORCING_LOG_ONLY"

# Step 5: Investigate
# What caused unexpected DENYs?
# Why did enforcement cause issues?

# Step 6: Fix
# Update policy / normalization / etc

# Step 7: Test in Stage 2 again
# Redeploy ENFORCING_LOG_ONLY after fixes
```

### Full Rollback to SHADOW
```bash
export APP_GOVERNANCE_MODE=SHADOW
# All RGE decisions logged only
# Old validator authoritative
# Zero enforcement

# Then:
# Investigate root cause
# Fix in code
# Re-enter stage progression from beginning
```

---

## Success Criteria for Each Stage

### Stage 1: SHADOW Success
```
✅ 100+ evaluations without errors
✅ 100% shadow consensus (no mismatches)
✅ Latency p95 < 10ms
✅ All semantic fields logged
✅ Operator review completed
✅ Ready for Stage 2
```

### Stage 2: ENFORCING_LOG_ONLY Success
```
✅ 1+ week of stable logging
✅ RGE decisions align with expectations
✅ No hypothetical DENYs on critical paths
✅ Phase 2A policy verified (environment isolation only)
✅ Operator confident
✅ Ready for Stage 3
```

### Stage 3: ENFORCING_NON_CRITICAL Success
```
✅ 1+ week of LOW/MODERATE enforcement stable
✅ 0 unexpected blocks
✅ 0 evaluation failures
✅ HIGH/CRITICAL decisions logged (not enforced)
✅ Operator confident
✅ Ready for Stage 4
```

### Stage 4: FULL_ENFORCING Success
```
✅ 1+ week of full enforcement stable
✅ Expected denial rate for Phase 2A (~0, only env isolation)
✅ 0 evaluation failures
✅ < 5ms p50 latency, < 10ms p95
✅ Monthly operator review ongoing
✅ Escalation path clear
✅ Governance layer operational
```

---

## Next: Phase 2B Preparation

Once FULL_ENFORCING stable:
- Authorization system ready (Phase 2B)
- Approval workflows enabled
- TTL/revocation support added
- Capability scopes added

But only AFTER Phase 2A proven stable and complete.

---

## Key Takeaway

Staged enforcement is not about delaying enforcement.

It's about:
- **Proving safety at each stage**
- **Building operator confidence incrementally**
- **Catching issues before full blast radius**
- **Enabling controlled rollback**

This is how production governance systems should roll out.
