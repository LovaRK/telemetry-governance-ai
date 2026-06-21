# Phase 2A Pre-Cutover Requirements

**Status**: ⏳ PENDING CUTOVER  
**Current Mode**: SHADOW (non-blocking, observational)  
**Target Mode**: ENFORCING (authoritative, fail-closed)  
**Timeline**: After 24-48 hours of monitoring + validation

---

## Critical: These Are Not Optional

Before moving from SHADOW to ENFORCING governance mode, ALL of the following must be satisfied. Skipping any creates operational risk and violates governance principles.

---

## Requirement 1: Representative Evaluation Volume

### Must Have
- **100+ governance evaluations minimum**
- Across multiple representative request types
- NOT just 5 requests or synthetic tests
- Real production traffic patterns

### What This Means
```
Current State: Shadow mode running, all requests evaluated
Goal: Accumulate 100+ real governance decisions

Example:
Day 1: 45 Splunk config saves → 45 evaluations
Day 2: 67 Splunk config saves → 67 evaluations
Total: 112 evaluations ✅ (meets requirement)
```

### How to Verify
```bash
# Count total [GOVERNANCE_DECISION] entries in logs
grep 'GOVERNANCE_DECISION' logs/*.json | wc -l
# Expected: ≥100

# Breakdown by decision type
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq '.rge_decision' | sort | uniq -c
```

### Why This Matters
- 5 evaluations = lab verification
- 100+ evaluations = real-world validation
- Governance systems must prove themselves on actual usage patterns

---

## Requirement 2: Zero Decision Mismatches (Across Evaluations)

### Must Have
- **0 (zero) decision mismatches**
- RGE decision MUST match old validator across all 100+ evaluations
- Phase 2A policy is simple (environment isolation only)
- Mismatches indicate normalization or policy evaluation bugs

### What This Means
```
RGE Decision vs Old Validator:
  ALLOW vs ALLOW ✅
  DENY vs DENY ✅
  ALLOW vs DENY ❌ MISMATCH (unacceptable)
  DENY vs ALLOW ❌ MISMATCH (unacceptable)
```

### How to Verify
```bash
# Count mismatches
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq 'select(.mismatch == true)' | wc -l
# Expected: 0

# If any mismatches, analyze them
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq 'select(.mismatch == true)' | \
  jq '{trace_id, rge_decision, old_validator_decision, input_fingerprint}'
```

### If You Find Mismatches
**DO NOT PROCEED TO ENFORCING MODE**

Debug sequence:
1. Identify the request (via trace_id)
2. Compare RGE reasons vs old validator reasons
3. Check resource normalization (trailing slash, case, ports)
4. Check policy evaluation logic
5. Fix and retest
6. Reset monitoring clock (start 24-48 hour window again)

### Why This Matters
- Mismatches = non-determinism or policy divergence
- Non-determinism breaks replay validation (Phase 2A promise)
- Policy divergence = RGE and old validator disagree on same request
- Both are disqualifying for enforcing mode

---

## Requirement 3: Zero Governance Evaluation Failures

### Must Have
- **0 (zero) [GOVERNANCE_EVALUATION_ERROR] entries**
- Every RGE evaluate() call must succeed
- Missing trace_id, correlation_id, policy_snapshot all caught at startup (fail-closed)
- Runtime evaluation never throws

### What This Means
```
Success: evaluate() returns GovernanceDecision
Failure: evaluate() throws Error (❌ not acceptable)

If ANY evaluation fails, governance can't be made authoritative
because fail-closed would create service outages
```

### How to Verify
```bash
# Count evaluation errors
grep 'GOVERNANCE_EVALUATION_ERROR' logs/*.json | wc -l
# Expected: 0

# If any errors, diagnose
grep 'GOVERNANCE_EVALUATION_ERROR' logs/*.json | \
  jq '.error'
```

### If You Find Failures
**DO NOT PROCEED TO ENFORCING MODE**

Debug sequence:
1. Examine error message
2. Check request context (trace_id, correlation_id present?)
3. Check policy_snapshot_hash value
4. Verify RGE initialization at startup
5. Review RuntimeGovernanceEngine constructor (must not throw if environment valid)
6. Fix root cause
7. Reset monitoring clock

### Why This Matters
- Enforcing mode with evaluation failures = service outage potential
- Governance unavailability should be: log and warn (shadow), NOT block (enforcing)
- Until evaluation is bulletproof, it can't be authoritative

---

## Requirement 4: Stable Normalization Across Edge Cases

### Must Have
- Input fingerprint consistency for semantic equivalents
- Verified across real request patterns

### Test Cases (Verify in Real Logs)
```
1. Trailing Slashes
   https://splunk.example.com:8089
   https://splunk.example.com:8089/
   → MUST have identical input_fingerprint

2. Case Variations
   https://Splunk.Example.Com:8089
   https://splunk.example.com:8089
   → MUST have identical input_fingerprint

3. Default Ports
   https://splunk.example.com:443
   https://splunk.example.com
   → MUST have identical input_fingerprint

4. Query Parameters (if any)
   splunk:config:https://splunk.com?version=1
   splunk:config:https://splunk.com?version=1
   → MUST have identical input_fingerprint

5. Unicode / URL Encoding
   https://splunk-é.example.com
   https://splunk-%C3%A9.example.com
   → MUST have identical (or explained) input_fingerprint
```

### How to Verify
```bash
# Check for multiple input_fingerprints in logs
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq '{input_fingerprint, normalized_resource}' | \
  sort | uniq -d
# Expected: 0 duplicates (or explain why)

# For same semantic resource, verify same fingerprint
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq 'select(.normalized_resource | test("splunk\\.example\\.com")) | \
       {input_fingerprint, normalized_resource}' | \
  jq -r '.input_fingerprint' | sort | uniq -c
# Expected: all entries same fingerprint if same resource
```

### Why This Matters
- Normalization bugs = same request → different decision_id → breaks replay
- Governance drift on normalization = determinism claim becomes false
- Must verify before forensic/replay requirements become binding

---

## Requirement 5: Deterministic Replay Validation

### Must Have
- Historical decision can be replayed with same result
- Requires: input_fingerprint → historical decision mapping

### Replay Test Procedure
1. Pick a governance decision from logs (capture input_fingerprint, decision)
2. Re-evaluate the same request TODAY
3. Compare decision_id and decision
4. MUST be identical

```bash
# Example:
# From Day 1 logs:
#   input_fingerprint: input-abc123
#   decision_id: decision-abc123
#   decision: ALLOW

# Today, re-evaluate same request:
curl -X POST /api/governance/replay \
  -H "X-Input-Fingerprint: input-abc123" \
  -H "Content-Type: application/json" \
  -d '{"action": "SAVE_SPLUNK_CONFIG", ...}'

# Response decision_id MUST be: decision-abc123
# Response decision MUST be: ALLOW
```

### How to Verify
```bash
# Extract historical decisions
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq '{input_fingerprint, decision_id, decision, created_at}' | \
  head -10 > /tmp/historical_decisions.json

# For each historical decision, verify can be replayed
# (requires ability to craft equivalent request)
```

### Why This Matters
- Replay = forensic trustworthiness
- Compliance = ability to prove what governance allowed/denied historically
- Before immutable audit ledger (Phase 2A Step 5), must validate replay works
- Phase 2B/2C will depend on this

---

## Requirement 6: Semantic Detail in Shadow Logs

### Must Have
- All of these fields in [GOVERNANCE_DECISION] logs:

```json
{
  "trace_id": "...",
  "correlation_id": "...",
  
  // RGE decision (semantic, not boolean)
  "rge_decision": "ALLOW",
  "rge_risk_level": "LOW",
  "rge_matched_policies": ["policy-environment-isolation-1"],
  "rge_enforcement_mode": "hard-block",
  "rge_reasons": ["No policies matched"],
  
  // Old validator (for comparison)
  "old_validator_decision": "ALLOW",
  "old_validator_reasons": [...],
  
  // Input identity
  "input_fingerprint": "input-abc123",
  "normalized_resource": "splunk:config:https://splunk.com:8089",
  
  // Mismatch detection
  "mismatch": false,
  
  // Environment
  "environment": "sandbox",
  "actor_id": "user-123",
  "action": "SAVE_SPLUNK_CONFIG",
  
  // Metadata
  "decision_id": "decision-abc123",
  "created_at": "2026-05-28T10:15:33Z"
}
```

### How to Verify
```bash
# Check all required fields present
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq 'keys' | sort | uniq
# Should include all fields above
```

### Why This Matters
- Semantic logging enables future debugging (not just boolean true/false)
- When governance becomes complex (Phase 2B), you'll need this detail
- Mismatch debugging impossible without semantic info

---

## Requirement 7: Zero Mode Boundary Violations

### Must Have
- GovernanceMode enum in use (not commented code)
- APP_GOVERNANCE_MODE environment variable controls behavior
- Shadow mode = no DENY blocks
- Enforcing mode = DENY blocks execution

### How to Verify
```bash
# Check mode is set
echo $APP_GOVERNANCE_MODE
# Expected: SHADOW (before cutover)

# Check startup log confirms mode
grep 'GOVERNANCE_MODE_STARTUP' logs/*.json
# Should show: {"mode": "SHADOW", ...}

# Check DENY decisions logged but not blocking (shadow mode)
grep 'GOVERNANCE_DECISION' logs/*.json | \
  jq 'select(.rge_decision == "DENY")' | wc -l
# If > 0: verify request still executed (not blocked)
```

### Why This Matters
- Prevents accidental DENY blocks in shadow mode
- Enables emergency rollback (set APP_GOVERNANCE_MODE=SHADOW)
- Makes governance controllable via environment (not code changes)

---

## Pre-Cutover Checklist

### Phase 1: Monitoring (24-48 hours, CURRENT)
```
Day 1-2: Shadow mode active, all requirements monitored

□ Requirement 1: ≥100 evaluations logged
□ Requirement 2: 0 mismatches detected
□ Requirement 3: 0 evaluation failures
□ Requirement 4: Input fingerprints stable
□ Requirement 5: Replay validation passes
□ Requirement 6: Semantic logs complete
□ Requirement 7: Mode boundary correct
```

### Phase 2: Analysis (1 day)
```
Day 3: Review all monitoring data

□ Print all [GOVERNANCE_DECISION] logs
□ Analyze mismatch patterns (if any)
□ Verify decision_id determinism
□ Confirm replay consistency
□ Check latency percentiles (p50, p95, p99)
□ Get operator sign-off
```

### Phase 3: Cutover (1 day)
```
Day 4: Move to enforcing mode

□ Set APP_GOVERNANCE_MODE=ENFORCING
□ Confirm startup log shows ENFORCING mode
□ Verify fail-closed behavior (missing context → throw)
□ Monitor for DENY blocks
□ Have rollback plan ready
```

### Phase 4: Monitoring (7 days post-cutover)
```
Days 5-11: Watch for unexpected behavior

□ Monitor DENY decision frequency
□ Check governance latency (should be <5ms)
□ Verify evaluation error rate stays 0
□ Log all DENY blocks for review
□ Plan removal of old validator (optional safety net)
```

---

## Failure Modes (Stop and Debug)

### Stop Immediately If

1. **Any mismatch found**
   - RGE decision ≠ old validator decision
   - Action: Debug normalization, policy evaluation, restart monitoring

2. **Any evaluation failure**
   - [GOVERNANCE_EVALUATION_ERROR] in logs
   - Action: Fix root cause, restart monitoring

3. **Normalization inconsistency**
   - Same semantic resource → different input_fingerprint
   - Action: Fix normalizeResource(), add test, restart monitoring

4. **Replay fails**
   - Historical decision can't be replayed with same result
   - Action: Investigate time-based dependencies, fix, restart monitoring

5. **Mode not controlled**
   - DENY blocks even in SHADOW mode
   - Action: Verify GovernanceMode enum in use, not commented code

---

## Post-Cutover Monitoring

Once ENFORCING, monitor:

```
Metric                              Alert Threshold
─────────────────────────────────────────────────
DENY decisions/day                  > 5 (investigate)
Evaluation errors/day               > 0 (investigate)
Evaluation latency p95              > 10ms (investigate)
Evaluation failures/day             > 0 (rollback if > 5)
```

---

## Emergency Rollback

If cutover produces unexpected behavior:

```bash
# Rollback to shadow mode (no DENY blocks)
export APP_GOVERNANCE_MODE=SHADOW
# Restart service
# Monitor logs
# Understand what went wrong
# Fix root cause
# Try cutover again
```

---

## Success Definition

✅ Cutover is successful when:

1. Zero DENY decisions for first 7 days (Phase 2A only does environment isolation)
2. Zero evaluation errors
3. RGE latency < 5ms (p95)
4. All governance logs complete and correct
5. Operator confidence high

---

## Sign-Off Template

Before moving to ENFORCING mode, must have:

```
Requirement 1 (100+ evaluations):  ☐ PASSED  ☐ FAILED
Requirement 2 (0 mismatches):      ☐ PASSED  ☐ FAILED
Requirement 3 (0 failures):        ☐ PASSED  ☐ FAILED
Requirement 4 (Normalization):     ☐ PASSED  ☐ FAILED
Requirement 5 (Replay validation): ☐ PASSED  ☐ FAILED
Requirement 6 (Semantic logs):     ☐ PASSED  ☐ FAILED
Requirement 7 (Mode boundary):     ☐ PASSED  ☐ FAILED

Operator Sign-Off: _____________________
Date: _____________________
```

---

## Next: Phase 2A Step 4 Begins After Cutover

Once ENFORCING mode active, proceed to:

1. Fail-closed proof tests
2. Immutable audit ledger (Phase 2A Step 5)
3. Phase 2B execution governance

Until then: monitor shadow mode and accumulate confidence.

---

## Reference Documents

- PHASE_2A_SHADOW_MODE_INTEGRATION.md
- governance-mode.ts
- governance-metrics.ts
- PHASE_2A_RUNTIME_GOVERNANCE_ENGINE_SPEC.md
