# Phase 2A Validation Sequence: Empirical Testing Plan

**Purpose**: Transition governance from theoretical architecture to operational reality through systematic, measurable validation.

**Timeline**: 15-20 days (4 stages × 3-5 days each)

**Success Criteria**: Prove governance is deterministic, observable, and operationally safe.

---

## Phase A: Passive Observation (Days 1-2)

### Objective
**Prove**: RGE is deterministic. Same input → same output, always.

### Mechanics

**APP_GOVERNANCE_MODE**: `SHADOW`

**What Happens**:
- RGE runs in parallel with old validator
- Old validator remains authoritative (makes all blocking decisions)
- RGE decisions logged for comparison only
- Zero blocking regardless of RGE decision

**What We're Measuring**:

| Metric | Target | Why |
|--------|--------|-----|
| cumulative_evaluations | ≥100 | Need volume for confidence |
| cumulative_mismatches | 0 | RGE must match validator exactly |
| cumulative_failures | 0 | RGE evaluation must succeed always |
| shadow_consensus_rate | 100% | Perfect agreement required |
| evaluation_latency_p95 | <5ms | Overhead acceptable |
| integrity_state | HEALTHY | All checks must pass |

**Success Condition**:
```
After 24-48 hours:
  ✓ 100+ evaluations collected
  ✓ 0 mismatches (RGE = validator)
  ✓ 0 failures (RGE never threw)
  ✓ 100% consensus (perfect agreement)
  → stage_transition_ready = true
```

**What to Watch For** (Red Flags):
- ❌ Mismatches > 0 → RGE differs from validator (normalization bug likely)
- ❌ Failures > 0 → RGE threw exception (policy engine error)
- ❌ Consensus < 100% → RGE not deterministic (fundamental problem)
- ❌ Latency p95 > 10ms → Performance issue

**Operator Actions**:
1. Deploy with `APP_GOVERNANCE_MODE=SHADOW`
2. Monitor logs every 5 minutes: `grep GOVERNANCE_OBSERVATION_STATE logs/*.json`
3. Alert on mismatches: `grep mismatch logs/*.json | grep true`
4. Alert on failures: `grep GOVERNANCE_EVALUATION_FAILED logs/*.json`
5. After 48 hours: Verify gates and approve Stage B

**If Issues Found**:
```
1. Stop and freeze current state
2. Review [GOVERNANCE_DECISION] logs with mismatches
3. Compare RGE decision vs old validator decision
4. Likely cause: Normalization bug or policy divergence
5. Fix in code
6. Return to Phase A monitoring
```

**Expected Logs**:
```
[GOVERNANCE_MODE_STARTUP]
  mode: "SHADOW"
  timestamp: "2026-05-28T..."

[GOVERNANCE_DECISION] (every decision)
  decision_id: "decision-abc123"
  input_fingerprint: "input-def456"
  decision: "ALLOW"
  action: "..."
  evaluation_ms: 2.5
  timestamp: "..."

[GOVERNANCE_OBSERVATION_STATE] (every 5 min)
  mode: "SHADOW"
  cumulative_evaluations: 50
  cumulative_mismatches: 0
  cumulative_failures: 0
  latest_consensus_rate: 100
  latest_integrity_state: "HEALTHY"
  stage_transition_ready: false
  timestamp: "..."
```

**Estimated Duration**: 24-48 hours

**Next Phase**: If all gates met → Approve Phase B

---

## Phase B: Replay Verification (Days 3-5)

### Objective
**Prove**: RGE decisions remain deterministic under replay. Same historical evaluation → same decision_id.

### Mechanics

**APP_GOVERNANCE_MODE**: Still `SHADOW` (no change)

**What Happens**:
- All Phase A monitoring continues
- Background: Every 5 minutes, sampler selects 10-20 recent decisions
- Background: Re-evaluate those decisions in isolation
- Compare: original decision_id vs replayed decision_id
- If mismatch: Indicates normalization drift or policy corruption

**What We're Measuring**:

| Metric | Target | Why |
|--------|--------|-----|
| replayed_snapshots | ≥20 | Need sample size |
| replay_match_rate | 100% | All replays must match |
| normalization_stable | Yes | No variants detected |
| policy_snapshot_hash | Consistent | Policy didn't change |
| schema_versions | Frozen | All versions locked |

**Success Condition**:
```
After 48 hours of Phase A + Phase B:
  ✓ 100+ evaluations collected
  ✓ 20+ snapshots replayed
  ✓ 100% replay matches
  ✓ 0 normalization variants
  ✓ Integrity = HEALTHY throughout
  → Ready for Phase C (Soft Authority)
```

**What to Watch For** (Red Flags):
- ❌ Replay mismatch > 0 → Decision hash changed (critical bug)
- ❌ Normalization variants detected → Drift in canonicalization
- ❌ Policy snapshot hash changed → Policy corrupted or modified
- ❌ Schema version mismatch → Frozen contract violated

**Operator Actions**:
1. No configuration change (still SHADOW)
2. Monitor logs for [GOVERNANCE_REPLAY_VALIDATION]
3. Alert if any replayed decision diverges
4. Investigate divergence root cause:
   - Is normalization rule different?
   - Did policy change?
   - Is schema version wrong?
5. Do NOT advance until all replays match

**Expected Logs**:
```
[GOVERNANCE_REPLAY_SAMPLING] (every 5 min)
  samples_collected: 15
  sample_buffer_size: 15
  timestamp: "..."

[REPLAY_VALIDATION_REPORT] (if enabled)
  window: "5m"
  summary:
    total_samples: 15
    matches: 15
    divergences: 0
    match_rate: 100
  timestamp: "..."
```

**Estimated Duration**: 24-48 hours (overlaps with Phase A/B boundary)

**Next Phase**: If replay gates met → Approve Phase C

---

## Phase C: Soft Authority (Days 6-10)

### Objective
**Prove**: RGE can decide autonomously. Decisions are reasonable (operator confidence).

### Mechanics

**APP_GOVERNANCE_MODE**: `ENFORCING_LOG_ONLY`

**What Changes**:
- RGE now DECIDES (is authoritative)
- RGE does NOT BLOCK (all requests succeed anyway)
- DENY decisions logged as "hypothetical" — "RGE would have blocked this"
- Operator reviews DENY logs to confirm they make sense

**What We're Measuring**:

| Metric | Target | Why |
|--------|--------|-----|
| hypothetical_denies | Reviewed daily | Operator must understand decisions |
| deny_rate | Expected baseline | Should match policy intent |
| unexpected_patterns | 0 | Decisions shouldn't be surprising |
| integrity_state | HEALTHY | Continuous health required |
| evaluation_failures | 0 | Must remain stable |

**Success Condition**:
```
After 1+ week of Phase C:
  ✓ RGE decided 500+ requests
  ✓ All hypothetical DENY logs reviewed
  ✓ 0 surprising decision patterns
  ✓ Operator confident RGE makes sense
  ✓ Integrity = HEALTHY throughout
  → Ready for Phase D (Controlled Enforcement)
```

**What to Watch For** (Red Flags):
- ❌ DENY rate unexpectedly high → Policy misconfigured
- ❌ DENY patterns don't match policy intent → Policy bug
- ❌ Operator confused by decisions → Trust gap
- ❌ Evaluation failures > 0 → Stability issue
- ❌ Integrity DEGRADED → System struggling

**Operator Actions**:
1. Change `APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY`
2. Restart services
3. Daily: Review [GOVERNANCE_DECISION] logs with decision="DENY"
4. Daily: Verify DENY reason makes sense
5. Weekly: Summarize DENY patterns for decision makers
6. Alert on anything unexpected
7. After 1+ week: Gather confidence level and approve Phase D

**Sample DENY Decision Review**:
```
[GOVERNANCE_DECISION]
  decision: "DENY"
  action: "access_production_database"
  resource: "prod-splunk:https://45.76.167.6:8089"
  risk_level: "CRITICAL"
  reasons:
    - "Production IP (45.76.167.6) is blocked in sandbox environment"
    - "Only approved sandbox IP (144.202.48.85) is permitted"
  actor_id: "agent-xyz"
  environment: "sandbox"
  
Operator review: "✓ Correct. Sandbox agent correctly blocked from production IP."
```

**Expected Logs**:
```
[GOVERNANCE_OBSERVATION_STATE] (every 5 min)
  mode: "ENFORCING_LOG_ONLY"
  cumulative_evaluations: 500+
  cumulative_mismatches: 0 (still tracking vs old baseline)
  cumulative_failures: 0
  latest_integrity_state: "HEALTHY"
  stage_transition_ready: false (waiting for 1+ week)
  timestamp: "..."
```

**Estimated Duration**: 5-7 days

**Next Phase**: If operator confident → Approve Phase D

---

## Phase D: Controlled Enforcement (Days 11-20)

### Objective
**Prove**: RGE can enforce decisions without breaking critical workflows.

### Mechanics - Stage 3a (Days 11-14): Non-Critical Enforcement

**APP_GOVERNANCE_MODE**: `ENFORCING_NON_CRITICAL`

**What Changes**:
- RGE blocks LOW and MODERATE risk decisions
- RGE logs but doesn't block HIGH and CRITICAL risk
- Partial enforcement (reduce blast radius)
- Monitor for unexpected blocks on low-risk decisions

**What We're Measuring**:

| Metric | Target | Why |
|--------|--------|-----|
| low_moderate_blocks | Expected baseline | Should block per policy |
| unexpected_blocks | 0 | No policy surprises |
| high_critical_logs | Reviewed | Must make sense |
| business_workflow_impact | None | Users shouldn't notice |
| integrity_state | HEALTHY | Continuous |

**Success Condition**:
```
After 1+ week of Stage 3:
  ✓ LOW/MODERATE blocks working correctly
  ✓ 0 unexpected blocks (operator reviewed)
  ✓ Business workflows unimpacted
  ✓ HIGH/CRITICAL logs reviewed (make sense)
  ✓ Integrity = HEALTHY throughout
  → Ready for Stage 4 (Full Enforcement)
```

### Mechanics - Stage 4 (Days 15+): Full Enforcement

**APP_GOVERNANCE_MODE**: `FULL_ENFORCING`

**What Changes**:
- RGE enforces ALL decisions (LOW, MODERATE, HIGH, CRITICAL)
- No escape hatches
- Fail-closed: Evaluation exception → DENY access
- Permanent operation begins

**What We're Measuring**:

| Metric | Target | Why |
|--------|--------|-----|
| integrity_state | HEALTHY (always) | Non-negotiable |
| evaluation_failures | ≤0% | Cannot tolerate exceptions |
| denial_rate | Expected baseline | Sanity check |
| operator_confidence | High | Sustained trust |

**Ongoing Monitoring** (Permanent):
- 24/7 alerts on integrity degradation
- Monthly operator review of governance health
- Continuous audit trail validation
- Weekly drift report review

**Success Condition**:
```
After 1+ week of full enforcement:
  ✓ Integrity = HEALTHY continuously
  ✓ 0 unexpected evaluation failures
  ✓ Denial rate matches policy intent
  ✓ Operator satisfied with stability
  → Permanent operation begins
  → Monthly reviews scheduled
  → Emergency rollback procedure documented
```

---

## Summary: Validation Pipeline

```
PHASE A: SHADOW (Passive)
  ↓ 100+ evals, 0 mismatches, 100% consensus
PHASE B: SHADOW (Replay Verify)
  ↓ 100+ replayed snapshots, 100% match
PHASE C: ENFORCING_LOG_ONLY (Soft Authority)
  ↓ 1+ week stable, operator confident
PHASE D-1: ENFORCING_NON_CRITICAL (Partial)
  ↓ 1+ week stable, 0 unexpected blocks
PHASE D-2: FULL_ENFORCING (Permanent)
  ↓ Continuous operation, monthly review
[MAINTAINED STATE: Governance in production]
```

**Total Timeline**: 15-20 days from SHADOW to full enforcement

---

## Gate Verification Process

### Before Each Phase Transition

1. **Gather Metrics**
   ```bash
   # Get latest observation state
   tail -1 logs/*.json | grep GOVERNANCE_OBSERVATION_STATE
   
   # Get drift report
   tail -5 logs/*.json | grep GOVERNANCE_DRIFT_REPORT
   
   # Get integrity check
   tail -5 logs/*.json | grep GOVERNANCE_INTEGRITY_CHECK
   ```

2. **Verify Gates** (Check metrics against thresholds)
   - Automated check: `stage_transition_ready` flag
   - Manual review: Compare metrics to gate thresholds
   - Operator sign-off: Document decision

3. **Review Anomalies**
   - Any mismatches: Investigate root cause
   - Any failures: Investigate exception
   - Any unexpected patterns: Investigate logic
   - Do NOT proceed until understood

4. **Approve and Change Mode**
   ```bash
   # Update environment
   export APP_GOVERNANCE_MODE=<next_stage>
   
   # Restart services
   docker-compose restart api
   
   # Verify mode changed
   grep GOVERNANCE_MODE_STARTUP logs/*.json | tail -1
   ```

5. **Monitor Transition**
   - Watch logs for 10 minutes after mode change
   - Alert if immediate errors or anomalies
   - Confirm observation state reflects new mode

---

## Emergency Procedures

### Rollback to SHADOW (Anytime)

```bash
# Immediate action if integrity fails or operator loses confidence
export APP_GOVERNANCE_MODE=SHADOW
docker-compose restart api

# Expected outcome:
# - RGE runs observational only
# - Old validator authoritative
# - Zero blocking
# - Full safety (worst case = return to old behavior)
```

### Phase Abort (Stay in Current Stage)

```bash
# If gates not met after expected duration:
# 1. Investigate root cause
# 2. Fix in code (if normalization bug or policy error)
# 3. Restart with same mode
# 4. Resume monitoring
# 5. Attempt gate verification again

# Example: Phase A → Phase B not ready
# → Investigate mismatches
# → Fix normalization
# → Restart SHADOW
# → Resume Phase A monitoring
```

---

## Success Metrics Summary

| Phase | Duration | Success Criteria | Gate |
|-------|----------|------------------|------|
| A | 24-48h | 100+ evals, 0 mismatches, 100% consensus | cumulative metrics |
| B | 24-48h | 20+ replayed, 100% match, 0 variants | replay validation |
| C | 5-7d | 500+ decisions, operator confident, 0 surprises | operator review |
| D1 | 5-7d | 0 unexpected blocks, workflows unimpacted | operator review |
| D2 | 1w+ | Integrity HEALTHY, 0 failures, stable | continuous |

---

## Roles and Responsibilities

### Technical Team
- Ensure metrics recording wired correctly
- Investigate any failures or anomalies
- Fix root causes (normalization, policy, engine)
- Prepare rollback procedures

### Operations Team
- Deploy with correct APP_GOVERNANCE_MODE
- Monitor logs every 5-10 minutes
- Review DENY decisions daily
- Alert on anomalies
- Approve phase transitions

### Decision Maker
- Review gate metrics before approving transition
- Understand the stage contract
- Approve operator confidence assessment
- Authorize rollback if needed

---

## Key Insights

### Why This Sequence?

1. **Phase A**: Prove RGE is deterministic (foundation)
2. **Phase B**: Prove replay works (forensics work)
3. **Phase C**: Prove decisions are reasonable (human trust)
4. **Phase D**: Prove enforcement works in production (operational reality)

### What Each Phase Tests

- **A**: Does RGE produce same decisions as validator? (Correctness)
- **B**: Do historical decisions remain deterministic? (Stability)
- **C**: Can operators trust RGE decisions? (Confidence)
- **D**: Can RGE enforce without breaking workflows? (Operational safety)

### No Phase Tests Security

- These phases prove governance WORKS
- Security testing (intentional policy violations, attack scenarios) is separate
- These phases assume: "RGE policy is correct, prove execution is sound"

---

**Delivered**: 2026-05-28  
**Status**: Validation sequence defined. Ready for empirical testing.  
**Next Step**: Execute Phase A (SHADOW mode, 24-48 hour observation).
