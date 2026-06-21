# Stage Contracts: Operational Governance Law

**Purpose**: Define the semantic and operational contract for governance at each stage.

These contracts are immutable within a stage. Changing them requires stage progression and operator sign-off.

---

## Stage 1: SHADOW (Days 1-2)

### Governance Contract

**AUTHORITY**: Old validator remains authoritative. RGE runs in parallel, observational only.

**DECISION ENFORCEMENT**: 
- Old validator decides: ALLOW or DENY
- RGE decision logged but not enforced
- No blocking occurs regardless of RGE decision

**FAILURE MODE**:
- RGE evaluation fails → Logged as failure metric, no impact (old validator decides)
- Old validator still operational → Normal operation continues

**OPERATOR OBLIGATIONS**:
1. Monitor [GOVERNANCE_OBSERVATION_STATE] every 5 minutes
2. Alert if `cumulative_mismatches` > 0 (indicates divergence)
3. Alert if `cumulative_failures` > 0 (indicates RGE exceptions)
4. Investigate any mismatch or failure immediately
5. Do NOT advance to Stage 2 until all anomalies resolved

**GATES TO ADVANCE**:
```
cumulative_evaluations ≥ 100    ✓ Need volume for statistical confidence
cumulative_mismatches = 0       ✓ Zero divergence between RGE and validator
cumulative_failures = 0         ✓ RGE must not throw
shadow_consensus_rate = 100%    ✓ RGE matches validator on all decisions
evaluation_latency_p95 < 5ms    ✓ RGE adds <5ms overhead
integrity_state = HEALTHY       ✓ All health checks pass
```

**ROLLBACK SEMANTICS**:
- Cannot rollback from SHADOW (it IS the rollback baseline)
- If any gate unmet: Continue SHADOW, investigate, fix, resume monitoring

**KEY SEMANTICS**:
- RGE is observational (no authority)
- Old validator is authoritative (retains blocking authority)
- Mismatches indicate: normalization bug, policy divergence, or schema incompatibility
- Failures indicate: RGE evaluation exception (requires investigation)

---

## Stage 2: ENFORCING_LOG_ONLY (Days 3-7)

### Governance Contract

**AUTHORITY**: RGE now internally authoritative. Violations logged but NOT enforced.

**DECISION ENFORCEMENT**:
- RGE decides: ALLOW or DENY
- All decisions execute (no blocking)
- DENY decisions logged as "hypothetical denial" for operator review
- Operator can see what WOULD have been blocked

**FAILURE MODE**:
- RGE evaluation fails → Falls back to ALLOW (fail-closed softens to permissive)
  - Failure logged with [GOVERNANCE_EVALUATION_FAILED] tag
  - Alert triggered immediately
- Policy engine exception → Emergency investigation required

**OPERATOR OBLIGATIONS**:
1. Monitor [GOVERNANCE_DECISION] logs for DENY outcomes
2. Alert if "hypothetical DENY" patterns look wrong or unexpected
3. Alert if DENY rate is surprisingly high (>expected policy baseline)
4. Alert if RGE evaluation failures occur
5. Do NOT advance to Stage 3 until operator confident in decisions

**GATES TO ADVANCE**:
```
observation_window ≥ 7 days              ✓ Need sustained observation period
integrity_state = HEALTHY (continuous)   ✓ Must remain HEALTHY for full week
zero_unexpected_denies                   ✓ Operator review confirms decisions logical
zero_evaluation_failures (or <1%)        ✓ RGE stable and reliable
mismatch_rate ≤ 0%                       ✓ RGE still matches validator baseline
```

**ROLLBACK SEMANTICS**:
```
If operator sees unexpected DENY patterns:
  → Set APP_GOVERNANCE_MODE=SHADOW
  → Restart services
  → Return to Stage 1 (RGE observational)
  → Investigate policy configuration
  → Fix RGE policy
  → Return to monitoring
```

**KEY SEMANTICS**:
- RGE is now the decision-maker
- "Hypothetical DENY" means: "RGE would block this, but we allowed it anyway (for testing)"
- All requests succeed (no actual blocking)
- Operator confidence is the gate (subjective but critical)
- This stage proves RGE decisions are not surprisingly wrong

---

## Stage 3: ENFORCING_NON_CRITICAL (Days 8-14)

### Governance Contract

**AUTHORITY**: RGE enforces for LOW and MODERATE risk. HIGH and CRITICAL logged only.

**DECISION ENFORCEMENT**:
- LOW risk DENY → Blocked (enforcement active)
- MODERATE risk DENY → Blocked (enforcement active)
- HIGH risk DENY → Logged but allowed (enforcement deferred)
- CRITICAL risk DENY → Logged but allowed (enforcement deferred)

**FAILURE MODE**:
- RGE evaluation fails on LOW/MODERATE → Falls back to ALLOW (permissive)
  - Failure logged with tag [GOVERNANCE_EVALUATION_FAILED]
  - Alert triggered (no emergency, degraded mode acceptable)
- On HIGH/CRITICAL → Never blocks (logged only)

**OPERATOR OBLIGATIONS**:
1. Monitor [GOVERNANCE_DECISION] logs for all DENY outcomes
2. Alert if LOW/MODERATE blocks are unexpected or excessive
3. Alert if HIGH/CRITICAL patterns look like policy misfire
4. Verify: "low-risk blocking doesn't break normal workflows"
5. Do NOT advance to Stage 4 until confident

**GATES TO ADVANCE**:
```
observation_window ≥ 7 days              ✓ Need full week at this stage
integrity_state = HEALTHY (continuous)   ✓ Must stay HEALTHY for week
zero_unexpected_blocks_on_low_moderate   ✓ Operator review confirms appropriate
zero_evaluation_failures (or <1%)        ✓ RGE stays stable
high_critical_logs_make_sense            ✓ Operator sees expected patterns
business_workflows_unimpacted            ✓ Users don't notice blocks
```

**ROLLBACK SEMANTICS**:
```
If unexpected LOW/MODERATE blocks occur:
  → Set APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY
  → Restart services
  → Return to Stage 2 (only logs, no blocking)
  → Investigate policy: LOW/MODERATE criteria
  → Fix policy or adjust risk levels
  → Return to monitoring Stage 2
```

**KEY SEMANTICS**:
- Partial enforcement (reduce blast radius)
- "Low-risk" blocking tests RGE correctness on lower-impact decisions
- HIGH/CRITICAL remain observational (preserve safety)
- Operator confidence is the gate
- This stage proves RGE can enforce without breaking critical paths

---

## Stage 4: FULL_ENFORCING (Day 15+)

### Governance Contract

**AUTHORITY**: RGE enforces ALL decisions. No fallback, fail-closed.

**DECISION ENFORCEMENT**:
- ALL risk levels: DENY is enforced (blocked)
- No fallback to ALLOW on any failure
- Fail-closed: Evaluation exception → Deny access (safest)

**FAILURE MODE**:
- RGE evaluation fails → Returns DENY (access blocked)
  - Failure logged with [GOVERNANCE_EVALUATION_FAILED]
  - Alert triggered (critical, emergency investigation)
  - May cause business disruption
  - Requires operator to validate then rollback if needed

**OPERATOR OBLIGATIONS**:
1. 24/7 monitoring during full enforcement
2. Alert on ANY evaluation failures (non-negotiable)
3. Monthly operator review of governance health
4. Continuous integrity checks (alert if DEGRADED or FAILED)
5. Maintain emergency rollback procedure

**GATES TO REMAIN IN ENFORCING**:
```
integrity_state = HEALTHY (always)           ✓ Non-negotiable
evaluation_failures = 0 (continuous)         ✓ No exceptions
decision_denial_rate ≈ expected_baseline     ✓ Sanity check
policy_snapshot_consistent (continuous)      ✓ No corruption
audit_trail_valid (continuous)               ✓ Immutable records
```

**EMERGENCY ROLLBACK SEMANTICS**:
```
IMMEDIATE ACTION if:
  integrity_state = FAILED
  OR widespread evaluation failures
  OR operator loses confidence

Then:
  → Set APP_GOVERNANCE_MODE=SHADOW
  → Restart services
  → All RGE decisions logged only
  → Old validator authoritative again
  → Full safety (return to old behavior)
  → Notify stakeholders of rollback
  → Investigate root cause
```

**KEY SEMANTICS**:
- No escape hatch (RGE is final authority)
- Fail-closed (safety over permissiveness)
- Integrity is non-negotiable gate
- Permanent monitoring required
- This is operational governance at scale

---

## Cross-Stage Semantics

### Decision Authority Progression
```
Stage 1: Old Validator Authoritative
  RGE: Observational only
  Authority: Old system

Stage 2: RGE Authoritative (but permissive)
  RGE: Decides (decides DENY)
  Enforcement: None (all succeed anyway)
  Authority: RGE (with operator override implicit)

Stage 3: RGE Authoritative (partial enforcement)
  RGE: Decides and enforces LOW/MODERATE
  RGE: Decides but doesn't enforce HIGH/CRITICAL
  Authority: RGE (with HIGH/CRITICAL escape hatch)

Stage 4: RGE Authoritative (full enforcement)
  RGE: Decides and enforces everything
  RGE: No escape hatches
  Authority: RGE (absolute)
```

### Metrics That Drive Gates

**critical_metrics**:
- `cumulative_evaluations` — Volume of decisions
- `cumulative_mismatches` — RGE vs validator divergence
- `cumulative_failures` — RGE exceptions
- `shadow_consensus_rate` — Agreement percentage
- `integrity_state` — Health assessment

**gates_per_stage**:

| Stage | Metric | Threshold | Why |
|-------|--------|-----------|-----|
| 1 | evaluations | ≥100 | Need statistical confidence |
| 1 | mismatches | 0 | Must prove identical decisions |
| 1 | failures | 0 | RGE must be stable |
| 1 | consensus | 100% | Perfect agreement required |
| 1 | latency p95 | <5ms | Overhead acceptable |
| 2 | duration | ≥7 days | Sustained observation required |
| 2 | integrity | HEALTHY | Continuous health required |
| 2 | unexpected_denies | 0 | Operator confidence required |
| 3 | duration | ≥7 days | Another week at partial enforcement |
| 3 | unexpected_blocks | 0 | Low-risk enforcement must work |
| 4 | integrity | HEALTHY | Always (non-negotiable) |
| 4 | failures | ≤0% | Cannot tolerate exceptions |

### Rollback Paths

**From Stage 2 → Stage 1**:
```
Trigger: Unexpected DENY patterns in hypothetical decisions
Action: APP_GOVERNANCE_MODE=SHADOW
Effect: RGE observational, old validator authoritative
Recovery: Fix RGE policy, return to Stage 1 monitoring
```

**From Stage 3 → Stage 2**:
```
Trigger: Unexpected blocks on LOW/MODERATE decisions
Action: APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY
Effect: Back to observational enforcement (no blocking)
Recovery: Fix policy, return to Stage 2 monitoring
```

**From Stage 4 → Stage 1** (Emergency):
```
Trigger: Integrity FAILED, evaluation failures widespread
Action: APP_GOVERNANCE_MODE=SHADOW
Effect: Complete safety (RGE observational)
Recovery: Investigate root cause, fix infrastructure, validate, return to Stage 1
```

### Operator Authority by Stage

| Stage | Operator Decision | Authority |
|-------|-------------------|-----------|
| 1 | Continue monitoring | Mandatory (gate unmet = continue) |
| 1 | Advance to Stage 2 | Required (gates + approval) |
| 2 | Investigate DENY patterns | Mandatory (understand decisions) |
| 2 | Advance to Stage 3 | Required (gates + confidence) |
| 3 | Investigate blocks | Mandatory (unexpected blocks require explanation) |
| 3 | Advance to Stage 4 | Required (gates + confidence) |
| 4 | Emergency rollback | Authority (can always revert to Stage 1) |
| 4 | Monthly review | Recurring validation |

---

## Summary: The Contract

**Stage 1 Contract**: "Prove RGE matches old validator perfectly. Same input → same output, always."

**Stage 2 Contract**: "RGE now decides, but doesn't block. Show operator that decisions are reasonable."

**Stage 3 Contract**: "RGE blocks low-risk decisions. Prove this doesn't break workflows."

**Stage 4 Contract**: "RGE has full authority. Maintain perfect health or rollback immediately."

Each stage contracts are IMMUTABLE within that stage. Changing them (changing gate thresholds, enforcement semantics, etc.) requires explicit operator decision and documentation.

---

**Delivered**: 2026-05-28  
**Status**: Governance law defined. Operationalization begins with Phase 2A shadow validation.
