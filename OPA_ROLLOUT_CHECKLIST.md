# L5 OPA Rollout Checklist

## Critical Safety Rules

```
❌ OPA must NEVER return a decision that is not emitted as an event
❌ Event emission failure must be fatal (throw, don't continue)
❌ Every policy_evaluated event must have: trace_id, source='system', mode='live'
❌ No policy evaluation may occur outside trace context
```

## Phase 1: security_first Policy (AUDIT MODE ONLY)

### Step 0: Pre-Flight

- [ ] OPA container runs: `docker-compose -f docker-compose.opa.yml up -d opa`
- [ ] OPA health: `curl http://localhost:8181/health` → 200
- [ ] Rego syntax: `docker run --rm -v $(pwd)/packages/core/policy/opa/policies:/policies openpolicyagent/opa:latest check /policies` → OK
- [ ] Env vars set:
  - `OPA_URL=http://localhost:8181`
  - `OPA_ENFORCEMENT_MODE=audit`
- [ ] evaluatePolicy() has non-optional event emission (throws on failure)
- [ ] Database has `pipeline_events` table with correct schema

### Step 1: Start OPA

```bash
docker-compose -f docker-compose.opa.yml up -d opa
sleep 5
curl http://localhost:8181/health
```

Expected: `{"result": {"status": "ok"}}`

### Step 2: Activate security_first in Audit Mode

Integrate `evaluatePolicy('security_first', input, 'audit')` into decision evaluation flow.

```typescript
const policyResult = await evaluatePolicy('security_first', input, 'audit');

// In audit mode: always returns result, never throws
// policyResult.decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL'
// Event has been emitted to pipeline_events
```

### Step 3: Monitor for ≥24 Hours

Check OPA health endpoint every 5 minutes:

```bash
watch -n 5 'curl -s http://localhost:3000/api/governance/health/policy | jq'
```

Expected output:
```json
{
  "status": "PASS",
  "opaReachable": true,
  "enforcementMode": "audit",
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

### Step 4: Validate Trace Attribution

```sql
-- Check all policy events have correct metadata
SELECT COUNT(*) AS total,
  COUNT(CASE WHEN trace_id IS NOT NULL THEN 1 END) AS have_trace,
  COUNT(CASE WHEN source = 'system' THEN 1 END) AS have_source,
  COUNT(CASE WHEN mode = 'live' THEN 1 END) AS have_live_mode
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND timestamp > NOW() - INTERVAL '24 hours';

-- Should show: total = have_trace = have_source = have_live_mode
```

```sql
-- Verify zero orphan events
SELECT COUNT(*) AS unattributed
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND (trace_id IS NULL OR source <> 'system' OR mode <> 'live')
  AND timestamp > NOW() - INTERVAL '24 hours';

-- Should return: 0
```

### Step 5: Review Policy Decisions

```sql
-- Decision distribution
SELECT (payload->>'decision')::text AS decision,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY decision;
```

Expected: ALLOW ~85%, DENY ~5%, REQUIRE_APPROVAL ~10%

```sql
-- Violated guardrails
SELECT jsonb_array_elements(payload->'violatedGuardrails')::text AS guardrail,
  COUNT(*) AS count
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND timestamp > NOW() - INTERVAL '24 hours'
  AND (payload->'violatedGuardrails')::text <> '[]'
GROUP BY guardrail
ORDER BY count DESC;
```

## GO/NO-GO Criteria: Audit → Enforce Mode

### Required (All Must Pass)

```
✅ OPA reachable: PASS
✅ policyEvaluationsLast24h: > 0 (at least some decisions evaluated)
✅ untracedPolicyEvents: 0 (CRITICAL)
✅ nonLivePolicyEvents: 0 (CRITICAL)
✅ unattributedPolicyEvents: 0 (CRITICAL)
✅ Decision distribution looks reasonable (mostly ALLOW, <10% DENY)
```

### Optional (Nice-to-Have Before Enforce)

```
⚡ Operator review of DENY decisions (understand why they're being blocked)
⚡ Security team sign-off on violated guardrails
⚡ Dashboard showing policy decision metrics
```

### If Any Required Check Fails

1. Do NOT proceed to enforce mode
2. Investigate root cause
3. Fix issue
4. Restart audit monitoring (24h countdown resets)

## Phase 2+: Additional Profiles (Future)

After security_first is validated in enforce mode (≥24h, zero trace loss):

1. Implement cost_optimization.rego
2. Deploy in audit mode (parallel to security_first enforce)
3. Monitor separately for ≥24h
4. Then enforce

Repeat for: operations_focused, conservative, data_quality

**Gap between profiles**: Stagger by 1-2 days to isolate behavior changes.

## Monitoring Dashboard (Built into UI)

Create a card showing:

```
OPA Policy Audit Dashboard

Security-First Policy (Audit Mode)
├─ Status: PASS ✅
├─ OPA Reachable: Yes
├─ Evaluations (24h): 128
├─ Untraced Events: 0 ✅
├─ Non-Live Events: 0 ✅
├─ Unattributed Events: 0 ✅
├─ Decision Distribution:
│  ├─ ALLOW: 85.2% (109)
│  ├─ DENY: 5.5% (7)
│  └─ REQUIRE_APPROVAL: 9.4% (12)
└─ Ready for Enforce: YES (after ≥24h)
```

## Rollback (If Needed)

If enforce mode encounters issues:

```bash
# Switch back to audit immediately
export OPA_ENFORCEMENT_MODE=audit

# Or disable OPA entirely
export OPA_URL=http://localhost:8181
# (and remove evaluatePolicy calls, or wrap in try-catch that defaults to ALLOW)
```

## Production Deployment

### Before Enabling Enforce Mode in Production

1. [ ] Staging environment: 24h audit mode with prod-like traffic volume
2. [ ] TLS enabled on OPA (certificate pinning recommended)
3. [ ] Client auth configured (mTLS or OAuth2)
4. [ ] Load testing: 1000+ policy evaluations/minute sustained
5. [ ] Circuit breaker: OPA unavailability → fallback to audit mode (don't block)
6. [ ] Monitoring + alerting wired up
7. [ ] Runbook for OPA recovery/rollback
8. [ ] Security team final sign-off

### Production Checklist

- [ ] Multi-node OPA (≥3 replicas)
- [ ] Load balancer in front of OPA
- [ ] Network isolation (OPA on internal network only)
- [ ] Audit logging of all policy decisions
- [ ] Alerts on:
  - OPA unreachable (5+ failed requests)
  - DENY decision rate spike (>20%)
  - Untraced events detected (critical)

---

## Success = This SQL Returns Zero

```sql
SELECT COUNT(*) FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND (trace_id IS NULL OR source <> 'system' OR mode <> 'live');
-- Must return: 0
-- If non-zero: DO NOT PROCEED TO ENFORCE MODE
```

---

## Next Steps (After L5 Phase 1)

1. Fix chaos test infrastructure dependencies
2. Run chaos suite (full production proof)
3. After chaos passes: enable OPA enforce mode
4. Implement L6: Observability Hardening
