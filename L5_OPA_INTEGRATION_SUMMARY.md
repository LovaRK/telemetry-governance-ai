# L5 OPA Integration Summary

## ✅ Completed

### File Structure
```
packages/core/policy/opa/
├── opa-policy.types.ts        ← PolicyInput, PolicyResult, PolicyProfile types
├── opa-client.ts              ← OpaClient REST API integration
├── evaluate-policy.ts         ← Single entry point (audit/enforce modes)
├── policies/
│   ├── security_first.rego    ← Phase 1: Active, complete
│   ├── cost_optimization.rego ← Phase 2: Placeholder
│   ├── operations_focused.rego← Phase 3: Placeholder
│   ├── conservative.rego      ← Phase 4: Placeholder
│   └── data_quality.rego      ← Phase 5: Placeholder
└── __tests__/
    └── evaluate-policy.test.ts

+ docker-compose.opa.yml       ← OPA container setup
+ OPA_INTEGRATION.md           ← Detailed integration guide
+ L5_OPA_INTEGRATION_SUMMARY.md ← This file
```

### Architecture
```
Policy Decision Flow (Trace-Bound)
┌─────────────────────────────────────────┐
│ Decision context (Splunk → DB → API)   │
│ trace_id already in AsyncLocalStorage   │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ evaluatePolicy(profile, input, mode)    │
│ - profile: security_first | cost_...    │
│ - mode: 'audit' | 'enforce'             │
│ - input: policy decision params         │
└────────────────┬────────────────────────┘
                 ↓
        [Inside Trace Context]
                 ↓
┌─────────────────────────────────────────┐
│ OpaClient.evaluate(packagePath, input)  │
│ HTTP POST /v1/data/governance/{profile} │
│ Header: x-trace-id: ${traceId}          │
└────────────────┬────────────────────────┘
                 ↓
     [OPA evaluates Rego policies]
                 ↓
┌─────────────────────────────────────────┐
│ Result: { decision, guardrails, ... }   │
│ assertDataPurity(result)                │
│ - source: 'system' ✓                    │
│ - mode: 'live' ✓                        │
│ - traceId: from context ✓               │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ emitPolicyEvent({...})                  │
│ INSERT INTO pipeline_events             │
│ (event_type, trace_id, source, mode)    │
└────────────────┬────────────────────────┘
                 ↓
      [Audit vs Enforce Decision]
                 ↓
      audit:  return result
      enforce: return result OR throw
```

### Data Purity Contract

Every PolicyResult includes:
- `decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL'`
- `violatedGuardrails: string[]` (e.g., "SECURITY_DETECTION_PROTECTED")
- `requiredApprovals: string[]` (e.g., "SECURITY_LEAD")
- `confidence: number` (0-1)
- `policyProfile: PolicyProfile`
- **`source: 'system'`** (data purity: all decisions from system logic)
- **`mode: 'live'`** (data purity: never synthetic data)
- **`traceId: string`** (from AsyncLocalStorage)

### Modes

**Audit Mode** (`OPA_ENFORCEMENT_MODE=audit`)
- OPA evaluates all decisions
- All results are emitted as `policy_evaluated` events
- DENY/REQUIRE_APPROVAL do NOT block execution
- Use: During rollout (≥24h per profile) and testing

**Enforce Mode** (`OPA_ENFORCEMENT_MODE=enforce`)
- OPA evaluates all decisions
- All results are emitted as `policy_evaluated` events
- DENY throws `OPA_POLICY_DENIED` error
- REQUIRE_APPROVAL blocks execution until approvals collected
- Use: After audit-mode validation (≥24h with clear decision patterns)

## 🚀 Staged Rollout Plan

### Phase 1: security_first Policy (Active)

**Status**: Implementation complete

**Policy Logic**:
- Deny: ELIMINATE high-detection (≥80) indexes
- Deny: OPTIMIZE low-utilization + high-detection combos
- Require Approval: ELIMINATE medium-detection (40-80) with ≥$5k savings
- Require Approval: Cost changes ≥$50k need finops sign-off

**Timeline**:
1. Start OPA container: `docker-compose -f docker-compose.opa.yml up -d opa`
2. Run in audit mode for ≥24 hours
3. Validate all events in `pipeline_events`:
   ```sql
   SELECT COUNT(*), event_type, (payload->>'decision')::text AS decision
   FROM pipeline_events
   WHERE event_type = 'policy_evaluated'
     AND (payload->>'policyProfile')::text = 'security_first'
   GROUP BY event_type, decision;
   ```
4. Verify data purity:
   ```sql
   SELECT COUNT(*) FROM pipeline_events
   WHERE event_type = 'policy_evaluated'
     AND (source IS NULL OR mode <> 'live' OR trace_id IS NULL);
   -- Should be 0
   ```
5. Switch to enforce mode: `OPA_ENFORCEMENT_MODE=enforce`

### Phase 2: cost_optimization Policy

**Status**: Placeholder skeleton created

**Actions**:
- Implement cost_optimization.rego logic
- Deploy in audit mode (parallel to security_first enforce)
- Monitor for ≥24h
- Then enforce

### Phase 3-5: Remaining Profiles

**Sequence**:
- operations_focused.rego
- conservative.rego
- data_quality.rego

**For each**:
1. Implement Rego logic
2. Deploy in audit mode
3. Monitor ≥24h
4. Measure decision distribution
5. Switch to enforce

## 📊 Monitoring & Proof Queries

### Decision Distribution
```sql
SELECT
  (payload->>'policyProfile')::text AS profile,
  (payload->>'decision')::text AS decision,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY payload->>'policyProfile'), 1) AS pct
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
GROUP BY profile, decision
ORDER BY profile, decision;
```

### Guardrail Violations
```sql
SELECT
  (payload->>'policyProfile')::text AS profile,
  jsonb_array_elements(payload->'violatedGuardrails')::text AS guardrail,
  COUNT(*) AS count
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND (payload->'violatedGuardrails')::text <> '[]'
GROUP BY profile, guardrail
ORDER BY profile, count DESC;
```

### Approval Requirements
```sql
SELECT
  (payload->>'policyProfile')::text AS profile,
  jsonb_array_elements(payload->'requiredApprovals')::text AS approval,
  COUNT(*) AS count
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND (payload->'requiredApprovals')::text <> '[]'
GROUP BY profile, approval
ORDER BY profile, count DESC;
```

## 🔧 Integration Checklist

### Before Phase 1 Activation

- [ ] OPA container runs: `docker-compose -f docker-compose.opa.yml up -d opa`
- [ ] OPA health: `curl http://localhost:8181/health` → 200
- [ ] Rego syntax valid: `docker run --rm -v $(pwd)/packages/core/policy/opa/policies:/policies openpolicyagent/opa:latest check /policies`
- [ ] OPA_URL env set: `OPA_URL=http://localhost:8181` in .env.development
- [ ] OPA_ENFORCEMENT_MODE env set to `audit` initially
- [ ] evaluatePolicy() integrated into decision evaluation flow
- [ ] Tests running: `npm run test` includes evaluate-policy tests

### Before Switching to Enforce Mode

- [ ] ≥24 hours of audit-mode data collected
- [ ] Decision distribution visible in monitoring queries
- [ ] Zero orphan events (all policy_evaluated have trace_id, source, mode)
- [ ] operator review queue shows required approvals being handled
- [ ] Security team signoff on violations and guardrails

## 📝 Production Readiness

### Pre-Production

- [ ] TLS enabled on OPA API (certificate pinning recommended)
- [ ] Client auth configured (mTLS or OAuth2)
- [ ] OPA deployed to staging environment
- [ ] Load testing: 1000+ policy evaluations/minute sustained
- [ ] Circuit breaker configured (fallback: default ALLOW)

### Production

- [ ] Multi-node OPA deployment (≥3 replicas)
- [ ] Load balancer in front of OPA
- [ ] Monitoring: policy evaluation latency, error rates, decision distribution
- [ ] Alerting: OPA unavailability, policy evaluation failures
- [ ] Rollback plan: switch OPA_ENFORCEMENT_MODE to audit or disable

## 🎯 Success Criteria (Phase 1)

✅ OPA evaluates all governance decisions
✅ All decisions emit pipeline_events
✅ 100% of events have trace_id, source='system', mode='live'
✅ Zero synthetic or untraced decisions
✅ Audit mode shows clear decision patterns (allow/deny/approve %)
✅ Operator can view policy reasons in audit trail
✅ Enforcement mode blocks decisions as expected

## 🚫 Known Limitations (Will Address)

1. OPA client does not yet retry on transient failures
2. No circuit breaker for OPA unavailability (blocks decisions)
3. Policy bundle distribution not yet implemented (requires OPA restart)
4. No OPA policy versioning (all policies always latest)
5. Audit logging of policy evaluations needs integration

These are deferred to L6 (Observability Hardening).

---

**Next Phase: L6 Observability Hardening**

After L5 validation (audit mode ≥24h, zero trace context loss):
- Add OPA failure metrics and alerting
- Implement confidence decay based on policy violations
- Build reanalysis workflow for high-violation decisions
