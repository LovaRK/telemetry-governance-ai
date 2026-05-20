# L5 OPA Integration Guide

## Overview

OPA (Open Policy Agent) is integrated as a **trace-bound policy gate** — every policy decision runs inside the trace context and emits a `policy_evaluated` event before returning to the caller.

## Architecture

```
Decision Input (from GovernanceTelemetryService)
    ↓
evaluatePolicy(profile, input, 'audit'|'enforce')
    ↓
[Inside trace context]
    ↓
OpaClient.evaluate() → OPA REST API
    ↓
assertDataPurity() ← validate {source, mode, traceId}
    ↓
emitPolicyEvent() → pipeline_events
    ↓
return PolicyResult or throw (if enforce + DENY)
```

## Setup

### Start OPA Locally

```bash
docker-compose -f docker-compose.opa.yml up -d opa
```

OPA will be available at `http://localhost:8181`.

### Environment Variables

Add to `.env.development`:

```dotenv
OPA_URL=http://localhost:8181
OPA_ENFORCEMENT_MODE=audit
```

For production, add TLS and authentication:

```dotenv
OPA_URL=https://opa.internal:8181
OPA_CLIENT_CERT=/secrets/opa-client.crt
OPA_CLIENT_KEY=/secrets/opa-client.key
OPA_CA_CERT=/secrets/opa-ca.crt
```

## Policy Profiles

### security_first (Active)

Protects high-detection indexes. Prevents elimination of indexes with detection ≥80.

```
detect >= 80          → DENY elimination
detect >= 40 + savings >= 5k  → REQUIRE_APPROVAL
```

### cost_optimization (Placeholder)

Prioritizes cost reduction. Coming in Phase 2.

### operations_focused (Placeholder)

Balances cost and reliability. Coming in Phase 2.

### conservative (Placeholder)

Highly restrictive. Coming in Phase 2.

### data_quality (Placeholder)

Protects data integrity. Coming in Phase 2.

## Integration Points

### 1. Decision Evaluation Flow

Replace inline policy checks with:

```typescript
const policyResult = await evaluatePolicy(
  tenantPolicyProfile,
  {
    tenantId,
    decisionId,
    indexName,
    proposedAction,
    scores,
    economics,
    evidence: {
      source: 'system',
      mode: 'live',
      traceId: getTraceId(),
    },
  },
  process.env.OPA_ENFORCEMENT_MODE === 'enforce' ? 'enforce' : 'audit'
);

// policyResult.decision: ALLOW | DENY | REQUIRE_APPROVAL
// policyResult.violatedGuardrails: string[]
// policyResult.requiredApprovals: string[]
```

### 2. Event Emission

Every policy evaluation automatically emits:

```sql
INSERT INTO pipeline_events (
  event_type,
  trace_id,
  source,
  mode,
  agent_decision_id,
  policy_profile,
  payload
) VALUES (
  'policy_evaluated',
  'trace-...',
  'system',
  'live',
  123,
  'security_first',
  '{"decision":"DENY","violatedGuardrails":[...]}'
);
```

### 3. Audit vs Enforce Modes

**Audit Mode** (`OPA_ENFORCEMENT_MODE=audit`):
- OPA evaluates all decisions
- Events are emitted for all decisions (ALLOW, DENY, REQUIRE_APPROVAL)
- DENY does not block execution
- Use during rollout and testing

**Enforce Mode** (`OPA_ENFORCEMENT_MODE=enforce`):
- OPA evaluates all decisions
- Events are emitted for all decisions
- DENY throws `OPA_POLICY_DENIED` error
- Execution blocked until guardrails cleared
- Use only after audit-mode validation

## Validation Checklist

### Before Enabling Any Profile

- [ ] OPA container is running (`docker-compose ps`)
- [ ] OPA health check passes (`curl http://localhost:8181/health`)
- [ ] At least one `.rego` file is in `/policies`

### Before Enabling Enforce Mode

- [ ] Policy profile has been running in audit mode for ≥24 hours
- [ ] SQL query confirms all `policy_evaluated` events have:
  - `source = 'system'`
  - `mode = 'live'`
  - `trace_id IS NOT NULL`
- [ ] Zero orphan events (events without corresponding execution journal entry)
- [ ] Dashboard shows policy decision distribution (allow/deny/approve percentages)

## Proof Queries

### Check policy_evaluated events are being emitted

```sql
SELECT COUNT(*), event_type, policy_profile, (payload->'decision')::text
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
GROUP BY event_type, policy_profile, (payload->'decision')::text
ORDER BY count DESC;
```

### Check for missing trace context in policy events

```sql
SELECT COUNT(*) AS orphans
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
  AND (trace_id IS NULL OR source IS NULL OR mode <> 'live');
```

### Check policy decisions by profile

```sql
SELECT
  (payload->>'policyProfile')::text AS profile,
  (payload->>'decision')::text AS decision,
  COUNT(*) AS count
FROM pipeline_events
WHERE event_type = 'policy_evaluated'
GROUP BY profile, decision
ORDER BY profile, decision;
```

## Rollout Sequence

1. **Phase 1: security_first (audit)**
   - Active security_first policy in audit mode
   - Monitor for ≥24 hours
   - Verify all events in pipeline_events with trace context

2. **Phase 2: security_first (enforce)**
   - Switch to enforce mode
   - Monitor DENY events and required approvals
   - Measure operator approval rate

3. **Phase 3: cost_optimization (audit)**
   - Implement and activate cost_optimization policy
   - Run in audit mode in parallel with security_first enforce

4. **Phase 4+: Remaining profiles**
   - Implement operations_focused, conservative, data_quality
   - Stagger activation over days
   - Monitor each independently before moving to enforce

## Debugging

### OPA Health

```bash
curl http://localhost:8181/health
```

### Evaluate Policy Manually

```bash
curl -X POST http://localhost:8181/v1/data/governance/security_first \
  -H "content-type: application/json" \
  -d '{
    "input": {
      "tenantId": "test",
      "decisionId": "dec-123",
      "indexName": "test_index",
      "proposedAction": "ELIMINATE",
      "scores": {"utilization": 45, "detection": 85, "quality": 72, "composite": 60},
      "economics": {"annualCostUsd": 12000, "estimatedSavingsUsd": 6000},
      "evidence": {"source": "postgres", "mode": "live", "traceId": "trace-123"}
    }
  }'
```

### Check OPA Logs

```bash
docker logs -f opa-policy-engine
```

### Verify Rego Syntax

```bash
docker run --rm -v $(pwd)/packages/core/policy/opa/policies:/policies \
  openpolicyagent/opa:latest check /policies
```

## Production Deployment

### Security

OPA must be secured in production:

1. **TLS**: Enable HTTPS on OPA API
2. **Auth**: Require client certificates or OAuth2 tokens
3. **Network**: Isolate OPA to internal network only
4. **Secrets**: Store OPA credentials in secret manager

### High Availability

Deploy OPA in multi-node setup with load balancing:

```yaml
services:
  opa-1:
    image: openpolicyagent/opa:latest
    # ...
  opa-2:
    image: openpolicyagent/opa:latest
    # ...
  opa-lb:
    image: haproxy:latest
    # routes to opa-1, opa-2
```

### Policy Distribution

For production, use OPA bundles to distribute policies without restarting OPA. Bundle server can be external or self-hosted.

## Next Steps

After L5 OPA integration is validated:

- Move to L6: Confidence score decay model
- Integrate OPA results into confidence scoring
- Add reanalysis workflow based on policy violations
