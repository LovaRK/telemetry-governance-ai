# Phase 2A: Operator Quick Reference

**Print This Page** — Post at your monitoring station

---

## ⚡ Quick Status Check

### Every 5 Minutes (Look For This In Logs)
```
[GOVERNANCE_OBSERVATION_STATE]
  mode: SHADOW (or current stage)
  cumulative_evaluations: X
  cumulative_mismatches: Y (should be 0)
  cumulative_failures: Z (should be 0)
  latest_integrity_state: HEALTHY (or DEGRADED/FAILED)
  stage_transition_ready: true/false
  stage_transition_reason: "..."
```

### Healthy Signs ✅
- ✅ `cumulative_evaluations` > 0 and increasing
- ✅ `cumulative_mismatches` = 0
- ✅ `cumulative_failures` = 0
- ✅ `latest_integrity_state` = HEALTHY
- ✅ Logs appear every 5 minutes without errors

### Red Flags 🚨
- 🚨 No logs for 10+ minutes (observer crashed?)
- 🚨 `cumulative_mismatches` > 0 (RGE vs validator mismatch)
- 🚨 `cumulative_failures` > 0 (evaluation errors)
- 🚨 `latest_integrity_state` = DEGRADED or FAILED
- 🚨 `shadow_consensus_rate` < 99%

---

## 📊 Log Grep Commands

```bash
# Real-time observation state (every 5 min)
tail -f logs/*.json | grep GOVERNANCE_OBSERVATION_STATE

# Drift reports (every 5 min summary)
tail -f logs/*.json | grep GOVERNANCE_DRIFT_REPORT

# Mismatches (critical alerts)
tail -f logs/*.json | grep "mismatch: true"

# Integrity problems (critical alerts)
tail -f logs/*.json | grep -E "state: DEGRADED|state: FAILED"

# All governance decisions (verbose)
tail -f logs/*.json | grep GOVERNANCE_DECISION

# Startup verification
grep -m 1 GOVERNANCE_MODE_STARTUP logs/*.json
```

---

## 🎯 Stage 1: SHADOW (Days 1-2)

**What Should Happen**:
- RGE runs in parallel with old validator
- Old validator remains authoritative (no blocking)
- RGE decisions logged for comparison only
- Accumulate 100+ evaluations
- Zero mismatches between RGE and old validator

**What To Watch**:
- [ ] `cumulative_evaluations` reaches 100+
- [ ] `cumulative_mismatches` stays 0
- [ ] `cumulative_failures` stays 0
- [ ] `shadow_consensus_rate` = 100%
- [ ] Latency p95 < 5ms

**When To Advance**:
```
If after 48 hours:
  ✅ 100+ evaluations
  ✅ 0 mismatches
  ✅ 0 failures
  ✅ 100% consensus rate
  → stage_transition_ready = true
  → Approve Stage 2: ENFORCING_LOG_ONLY
```

**When To Rollback**:
```
If you see:
  ❌ Mismatches > 0
  ❌ Failures > 0
  ❌ Integrity = FAILED
  → Keep APP_GOVERNANCE_MODE=SHADOW
  → Investigate root cause
  → Fix issue
  → Return to monitoring
```

---

## 🎯 Stage 2: ENFORCING_LOG_ONLY (Days 3-7)

**What Should Happen**:
- RGE internally authoritative (it decides)
- Violations logged but NOT blocked (still safe)
- Test if RGE decisions are surprising
- Monitor for hypothetical DENY reasons

**What To Watch**:
- [ ] No unexpected decision patterns
- [ ] "Hypothetical DENY" logs don't surprise you
- [ ] No blocking occurs (traffic flows normally)
- [ ] Integrity = HEALTHY for 1+ week

**When To Advance**:
```
If after 1+ week:
  ✅ No unexpected DENYs
  ✅ Integrity = HEALTHY
  ✅ Operator confidence high
  → stage_transition_ready = true
  → Approve Stage 3: ENFORCING_NON_CRITICAL
```

**When To Rollback**:
```
If you see:
  ❌ Surprising DENY patterns
  ❌ Business logic violated
  ❌ Integrity = DEGRADED/FAILED
  → Set APP_GOVERNANCE_MODE=SHADOW
  → Restart services
  → Investigate what went wrong
  → Fix RGE policy or normalization
  → Return to Stage 1
```

---

## 🎯 Stage 3: ENFORCING_NON_CRITICAL (Days 8-14)

**What Should Happen**:
- RGE blocks LOW and MODERATE risk decisions
- HIGH and CRITICAL logged but NOT blocked
- Reduces blast radius of enforcement
- Monitor for unexpected blocks

**What To Watch**:
- [ ] No unexpected blocks on LOW/MODERATE
- [ ] HIGH/CRITICAL logs make sense
- [ ] Business processes flow normally
- [ ] Integrity = HEALTHY for 1+ week

**When To Advance**:
```
If after 1+ week:
  ✅ 0 unexpected blocks
  ✅ Integrity = HEALTHY
  ✅ Operator confidence high
  → stage_transition_ready = true
  → Approve Stage 4: FULL_ENFORCING
```

**When To Rollback**:
```
If you see:
  ❌ Unexpected blocks (users can't work)
  ❌ Integrity = FAILED
  → Set APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY
  → Restart services
  → Investigate why blocks are unexpected
  → Fix policy
  → Return to Stage 2
```

---

## 🎯 Stage 4: FULL_ENFORCING (Day 15+)

**What Should Happen**:
- RGE blocks ALL decisions (no fallback)
- Fail-closed enforcement (most secure)
- Permanent monitoring required
- Monthly operator review

**What To Watch**:
- [ ] Integrity = HEALTHY continuously
- [ ] Evaluation failures = 0
- [ ] Denial rate ≈ 0 for Phase 2A (only env isolation)
- [ ] Latency p95 < 10ms

**Emergency Rollback** (if needed):
```
Set APP_GOVERNANCE_MODE=SHADOW
Restart services
→ All RGE decisions logged only, no blocking
→ Old validator authoritative again
→ Full safety (worst case: return to old behavior)
```

---

## 🔧 How to Change Modes

### Change APP_GOVERNANCE_MODE
```bash
# Option 1: Edit .env file
# Before:  APP_GOVERNANCE_MODE=SHADOW
# After:   APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY

# Option 2: Docker environment
export APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY
docker-compose restart api

# Option 3: Kubernetes (if applicable)
kubectl set env deployment/api APP_GOVERNANCE_MODE=ENFORCING_LOG_ONLY

# Verify change took effect:
grep GOVERNANCE_MODE_STARTUP logs/*.json | tail -1
# Should show new mode
```

### Mode Progression
```
SHADOW
  ↓ (100+ evals, 0 mismatches, 100% consensus)
ENFORCING_LOG_ONLY
  ↓ (1+ week stable, no surprises)
ENFORCING_NON_CRITICAL
  ↓ (1+ week stable, no blocks)
FULL_ENFORCING
  ↓ (permanent monitoring)
[MAINTAINED STATE]
```

---

## 📈 Key Metrics to Track

### Decision Volume
```
governance_decisions_total: X
  Growth expected: linear with traffic
  Red flag: Sudden drop (is evaluations stopping?)
```

### Mismatches (Most Important)
```
governance_shadow_mismatches_total: X
  Target for Stage 1: 0
  Target for Stage 2: 0
  Threshold: > 0 requires investigation
```

### Failures (Critical)
```
governance_evaluation_failures_total: X
  Target: 0
  Threshold: > 0 requires immediate investigation
  This may indicate RGE evaluation exception
```

### Consensus Rate (Critical)
```
shadow_consensus_rate: X%
  Target: 100%
  Threshold: < 99% requires investigation
  This is mismatches / total decisions
```

### Latency (Performance)
```
governance_evaluation_ms: p50, p95, p99
  Target p95: < 5ms (Phase 2A)
  Target p95: < 10ms (Phase 2B)
  Red flag: p95 > 20ms (system degradation)
```

---

## 🚨 Critical Alert Triggers

### IMMEDIATE ACTION REQUIRED
```
❌ state: FAILED
   → Set APP_GOVERNANCE_MODE=SHADOW
   → Restart services
   → Investigate integrity_check details
   → Contact technical team

❌ evaluation_failures > 0
   → Check [GOVERNANCE_EVALUATION_FAILED] logs
   → Look for exceptions in RGE
   → May indicate policy engine error

❌ mismatches > 0
   → Check [GOVERNANCE_DECISION] with mismatch: true
   → Compare rge_decision vs old_validator_decision
   → Likely indicates normalization bug
   → Check mismatch_type for clue
```

### MONITOR & REPORT
```
⚠️  state: DEGRADED
   → Stable enough to continue
   → Requires attention before next stage
   → Check specific check that failed

⚠️  latency p95 > 10ms
   → Performance degradation
   → May be RGE evaluation overhead
   → Check system load

⚠️  consensus_rate 95-98%
   → Some mismatches (below target)
   → May be acceptable if improving
   → Watch for stabilization
```

---

## 📋 Daily Checklist

### Morning (When You Arrive)
```
[ ] Check logs for overnight errors
[ ] Verify [GOVERNANCE_MODE_STARTUP] shows correct mode
[ ] Confirm [GOVERNANCE_OBSERVATION_STATE] logs present every 5 min
[ ] Check cumulative_evaluations increased since yesterday
[ ] Check cumulative_mismatches still = 0
```

### Hourly (During Business Hours)
```
[ ] Glance at latest [GOVERNANCE_OBSERVATION_STATE]
[ ] Verify integrity_state = HEALTHY
[ ] Check stage_transition_ready (true = gates might be met)
[ ] Alert if new mismatches detected
```

### End Of Day
```
[ ] Review all [GOVERNANCE_DRIFT_REPORT] entries
[ ] Total evaluations for the day?
[ ] Any failures or mismatches?
[ ] Latency trends?
[ ] Summary for handoff to next shift
```

---

## 🎓 How to Interpret Logs

### Example: Healthy Observation State
```json
[GOVERNANCE_OBSERVATION_STATE]
{
  "mode": "SHADOW",
  "cumulative_evaluations": 245,
  "cumulative_mismatches": 0,
  "cumulative_failures": 0,
  "latest_consensus_rate": 100,
  "latest_integrity_state": "HEALTHY",
  "stage_transition_ready": false,
  "stage_transition_reason": "SHADOW gates not met: need 100+ evals (have 245✓), 0 mismatches (have 0✓), 0 failures (have 0✓), 100% consensus (have 100✓), latency p95 < 5ms - GATES MET, waiting for operator review"
}
```

**Interpretation**: All gates are met, ready for Stage 2 after operator review.

### Example: Problem Found
```json
[GOVERNANCE_OBSERVATION_STATE]
{
  "mode": "SHADOW",
  "cumulative_evaluations": 95,
  "cumulative_mismatches": 3,
  "cumulative_failures": 1,
  "latest_consensus_rate": 98.7,
  "latest_integrity_state": "DEGRADED",
  "stage_transition_ready": false,
  "stage_transition_reason": "SHADOW gates not met: evaluation failures (1 > threshold 0), shadow consensus 98.7% < threshold 99%"
}
```

**Interpretation**: 
- Mismatches detected (3) — need investigation
- Evaluation failure (1) — RGE exception occurred
- Consensus rate dropping — not ready for Stage 2

**Action**: Investigate root cause, fix issue, continue monitoring

---

## 📞 Escalation Path

### Level 1 (You Can Fix)
- Change APP_GOVERNANCE_MODE
- Restart services
- Review logs
- Check metrics

### Level 2 (Contact Technical Team)
- RGE policy seems wrong (unexpected decisions)
- Normalization bugs (mismatches)
- Evaluation failures (exceptions)

### Level 3 (Emergency Rollback)
- Integrity = FAILED
- Widespread business impact
- Can't identify root cause
- → Set APP_GOVERNANCE_MODE=SHADOW
- → Rollback to old behavior
- → Notify stakeholders
- → Investigate post-incident

---

## 📚 Full Documentation

For detailed information, see:
- **PHASE_2A_STAGED_ENFORCEMENT_ROADMAP.md** — Full strategy with examples
- **PHASE_2A_SHADOW_VALIDATION_CHECKLIST.md** — Detailed monitoring guide
- **PHASE_2A_STARTUP_INTEGRATION.md** — How to start the system
- **PHASE_2A_IMPLEMENTATION_STATUS.md** — Complete technical status

---

## Quick Links (Copy to Browser)

```
Production Logs Dashboard: [YOUR_LOG_URL]/governance
Metrics Dashboard: [YOUR_METRICS_URL]/governance
Alert Management: [YOUR_ALERTING_URL]
Incident Response: [YOUR_WIKI]/phase-2a-incidents
```

---

**Last Updated**: 2026-05-28  
**Maintained By**: [Technical Team]  
**Print Date**: _______________  
**Shift**: Morning / Evening / Night (circle)
