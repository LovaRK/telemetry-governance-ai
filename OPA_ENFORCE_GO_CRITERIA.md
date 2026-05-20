# OPA Enforce Mode: Hard Go/No-Go Rules

## Status Summary

```text
L3 route factory enforcement: validated
L4 invariant endpoint/proof queries: created
L5 OPA audit-mode scaffold: created
Production proof gate: pending chaos infrastructure repair
```

---

## Critical Rule: All Events Must Be Traced

**DO NOT enable `OPA_ENFORCEMENT_MODE=enforce` until this query returns ZERO:**

```sql
SELECT COUNT(*)
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND (
    trace_id IS NULL
    OR source <> 'system'
    OR mode <> 'live'
  );
```

**Result:** If non-zero, decision cannot be traced. Enforce mode is blocked. Investigate and restart audit-mode countdown.

---

## Secondary Rule: Every Decision Must Have a Policy Event

**Before entering enforce mode, verify this query returns empty (no orphan decisions):**

```sql
SELECT d.decision_id
FROM decisions d
LEFT JOIN pipeline_events pe
  ON pe.decision_id = d.decision_id
 AND pe.event_type = 'policy_evaluated'
WHERE d.status IN ('UNDER_REVIEW', 'APPROVED', 'EXECUTED')
  AND pe.decision_id IS NULL;
```

**Result:** If any rows returned, a decision executed without being evaluated by OPA. Enforce mode is blocked.

---

## OPA Health Endpoint: Continuous Monitoring

**Endpoint:** `GET /api/governance/health/policy`

**Returns:**
```json
{
  "status": "PASS|WARN",
  "opaReachable": true,
  "enforcementMode": "audit|enforce",
  "policyEvaluationsLast24h": 128,
  "untracedPolicyEvents": 0,
  "nonLivePolicyEvents": 0,
  "unattributedPolicyEvents": 0,
  "denyCountAuditMode": 7,
  "decisionDistribution": {
    "ALLOW": 110,
    "DENY": 7,
    "REQUIRE_APPROVAL": 11
  },
  "readyForEnforceMode": true
}
```

**Monitor Every 5 Minutes During Audit Phase**
```bash
watch -n 5 'curl -s http://localhost:3000/api/governance/health/policy | jq'
```

**PASS Criteria (All Required)**
- `opaReachable` = true
- `untracedPolicyEvents` = 0 (CRITICAL)
- `nonLivePolicyEvents` = 0 (CRITICAL)
- `unattributedPolicyEvents` = 0 (CRITICAL)
- `policyEvaluationsLast24h` > 0
- `readyForEnforceMode` = true

**If Status is WARN:**
- Investigate immediately
- Do NOT proceed to enforce mode
- Restart audit-mode countdown if any CRITICAL criteria fail

---

## Audit Mode Duration

**Minimum: 24 hours of continuous operation**

- Start: `OPA_ENFORCEMENT_MODE=audit`
- During: Monitor health endpoint every 5 minutes
- After 24h: Run the two SQL queries above
- If both return zero: Safe to transition to enforce mode
- If either returns non-zero: Extend audit period, investigate root cause, restart countdown

---

## Transition Checklist: Audit → Enforce

Before setting `OPA_ENFORCEMENT_MODE=enforce`:

- [ ] At least 24 hours has passed since audit mode activation
- [ ] Health endpoint shows `status: PASS` and `readyForEnforceMode: true`
- [ ] SQL Query 1 returns zero (all policy_evaluated events traced)
- [ ] SQL Query 2 returns empty (no orphan decisions)
- [ ] Decision distribution is reasonable:
  - ALLOW ~85%
  - DENY ~5%
  - REQUIRE_APPROVAL ~10%
- [ ] Security team has reviewed policy violations and decision patterns
- [ ] Operator dashboard shows policy decision trends (no anomalies)

---

## Enforce Mode Behavior

Once `OPA_ENFORCEMENT_MODE=enforce`:

- Policy decisions are **evaluated and emitted as events** (same as audit mode)
- ALLOW and REQUIRE_APPROVAL: execution proceeds
- DENY: throws `[OPA_POLICY_DENIED]` error, **blocks execution**
- No execution happens without a policy event

---

## Rollback (If Needed)

If enforce mode encounters unexpected issues:

```bash
# Revert to audit immediately
export OPA_ENFORCEMENT_MODE=audit
# Service restarts with no blocks
```

All decisions continue to be evaluated and emitted. No decision loss.

---

## Decision Distribution Baseline (security_first policy)

Expected after 24h in audit mode:

| Decision | Percent | Reason |
|----------|---------|--------|
| ALLOW | ~85% | Most decisions pass policy |
| DENY | ~5% | Critical guardrails violations (high detection, cost changes >50k) |
| REQUIRE_APPROVAL | ~10% | Medium-risk combos (detection 40-80% + savings ≥5k) |

If distribution is significantly different:
- ALLOW < 70%: Policy is too restrictive, review guardrails
- DENY > 15%: Too many violations, investigate root cause
- REQUIRE_APPROVAL > 30%: Approval queue might become bottleneck

---

## Production Readiness

### Safe to Deploy Now
✅ Route enforcement (L3) — 43/43 routes validated  
✅ Invariant health endpoint (L4) — Proof queries in place  
✅ OPA scaffolding (L5) — Audit mode ready

### Before Enforce Mode
⏳ Run audit for ≥24h with production-like traffic  
⏳ Both SQL queries return correct values  
⏳ Health endpoint shows PASS  
⏳ Security team sign-off

### After Chaos Tests Pass
✅ Full production proof  
✅ Proceed with enforce mode  
✅ Monitor DENY decision rate (alert if >20%)

---

## Key Invariants (Always Enforced)

**L3: Route Layer**
- Every route uses `createRoute()` or `createStreamRoute()`
- No raw exports, no direct JSON responses
- CI gate blocks bypass paths

**L4: Invariant Health Layer**
- Proof queries verify trace attribution across all 43 routes
- Returns PASS only when all counts are zero

**L5: OPA Policy Layer**
- Every policy decision is traced (source='system', mode='live', traceId)
- Event emission is non-optional (fatal on failure)
- Audit/enforce modes are gated (≥24h validation required)
- No policy decision without trace context

---

## Success = This SQL Returns Zero

```sql
SELECT COUNT(*) FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND (trace_id IS NULL OR source <> 'system' OR mode <> 'live');
-- Must return: 0
-- If non-zero: DO NOT PROCEED TO ENFORCE MODE
```

This is your proof gate. Do not skip it.
