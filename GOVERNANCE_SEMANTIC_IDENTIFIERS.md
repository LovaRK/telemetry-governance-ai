# Governance Semantic Identifiers

**Critical**: Distinct identifiers serve different forensic and compliance purposes. Conflating them breaks governance audit trails.

---

## The Seven Identifiers

### 1. `trace_id` - Workflow Lineage
**Purpose**: Follow a request across ALL services and boundaries  
**Scope**: Entire request lifecycle (client → service → database → response)  
**Immutability**: Generated once, propagated everywhere  
**Uniqueness**: Unique per API request (NOT per governance decision)

**Example**:
```
POST /api/splunk/config
  trace_id: uuid-req-12345
  
  ↓ passes through:
  
  splunk-config-routes.ts
  splunk-config-service.ts
  database writes
  logs
  
  All must include: trace_id: uuid-req-12345
```

**Use Case**: "Show me everything that happened for request X"

---

### 2. `correlation_id` - Causal Chain
**Purpose**: Link semantically related operations (retries, cascades, parent-child)  
**Scope**: May span multiple requests if they're causally related  
**Immutability**: Inherited from parent request or generated  
**Uniqueness**: Unique per logical operation (may have multiple trace_ids)

**Example**:
```
User saves Splunk config
  correlation_id: uuid-corr-67890
  trace_id: uuid-req-12345
  
  Service validates config
  Service tests connection (retry loop)
    trace_id: uuid-req-12346 (different)
    correlation_id: uuid-corr-67890 (same)
    
  Both trace_ids but same correlation_id = causally linked
```

**Use Case**: "Show me all retries and related actions for operation Y"

---

### 3. `input_fingerprint` - Normalized Request Identity
**Purpose**: Forensic grouping; enables replay detection  
**Scope**: Only the normalized, canonical request (not policy result)  
**Immutability**: Deterministic SHA256(normalized request)  
**Uniqueness**: Same for all evaluations of semantically identical requests

**Example**:
```
Request 1 (2026-05-28 10:00):
  raw: https://Splunk.Example.Com:8089/
  normalized: https://splunk.example.com:8089
  input_fingerprint: input-sha256abc123

Request 2 (2026-05-28 10:01):
  raw: https://splunk.example.com:8089
  normalized: https://splunk.example.com:8089
  input_fingerprint: input-sha256abc123  ← SAME

Request 3 (2026-05-29 14:00):
  raw: https://splunk.example.com:8089
  normalized: https://splunk.example.com:8089
  input_fingerprint: input-sha256abc123  ← STILL SAME
```

**Forensic Use**: "How many times was this request evaluated?" (count by input_fingerprint)  
**Replay Use**: "Was this exact request ever approved before?" (search audit by input_fingerprint)

---

### 4. `decision_fingerprint` (PROPOSED, Future)
**Purpose**: Deterministic evaluation result identity  
**Scope**: Normalized request + policy snapshot + decision enum  
**Immutability**: SHA256(input_fingerprint + policy_snapshot_hash + decision)  
**Uniqueness**: Same for all evaluations of same request under same policy with same decision

**Note**: Currently called `decision_id` in implementation. Should be renamed in Phase 2B.

**Example**:
```
Request at Policy V1:
  decision_id: decision-sha256def456
  decision: ALLOW
  risk_level: LOW

Same request, Policy V2 (policy changed):
  decision_id: decision-sha256ghi789 (DIFFERENT)
  decision: ALLOW (same decision)
  risk_level: MODERATE
  
Policy snapshot changed → decision_id changes → different governance fingerprint
```

**Use**: "Under the old policy, what decision did this request get?"

---

### 5. `decision_id` (Phase 2A) → `decision_fingerprint` (Phase 2B+)
**Currently**: Includes decision in the hash  
**Semantically**: Is a decision fingerprint, not decision identity  
**Should Be Renamed**: To avoid future confusion with `event_id`

**Migration Path**:
- Phase 2A: Keep as `decision_id` (works fine, just semantically imprecise)
- Phase 2B: Rename to `decision_fingerprint`
- Phase 2B: Introduce true `event_id` for immutable audit ledger

---

### 6. `authorization_id` - Permission Grant (Phase 2B+)
**Purpose**: Discrete, revocable permission grant  
**Scope**: Single execution authorization  
**Immutability**: Immutable once issued; can be revoked (new record, not update)  
**Uniqueness**: Unique per authorization grant

**Note**: Not yet implemented in Phase 2A. Required for Phase 2B (approvals).

**Example** (Phase 2B):
```
Governance Decision: REQUIRE_APPROVAL
  decision_id: decision-abc123
  
Human approves:
  authorization_id: authz-uuid-xyz
  authorized_by: admin-user-123
  authorized_at: 2026-05-28T10:15:00Z
  expires_at: 2026-05-28T10:35:00Z (20 min TTL)
  nonce: one-time-use-code
  
If revoked:
  authorization_id: authz-uuid-xyz (same)
  revoked: true
  revoked_at: 2026-05-28T10:20:00Z
  
Same ID, but revoked status changed
```

**Use**: "Is this approval still valid?" (check authorization_id + not revoked + within TTL)

---

### 7. `event_id` - Immutable Audit Record (Phase 2A Step 5+)
**Purpose**: Unique identifier for immutable audit event  
**Scope**: Single append-only audit log entry  
**Immutability**: Immutable once logged (no UPDATE/DELETE)  
**Uniqueness**: Unique per log entry; never reused

**Example** (Phase 2A Step 5):
```
governance_audit_events table:

event_id          | decision_id  | trace_id  | decision | created_at
───────────────────────────────────────────────────────────────────
event-uuid-001    | decision-123 | trace-abc | ALLOW    | 2026-05-28T10:15:00Z
event-uuid-002    | decision-123 | trace-def | ALLOW    | 2026-05-28T10:16:00Z
event-uuid-003    | decision-456 | trace-ghi | DENY     | 2026-05-28T10:17:00Z

Same decision_id (events 1-2) but different event_ids
Different decision_ids but same trace_id prefix = different requests, same trace
```

**Audit Use**: "Show me the immutable record for approval #X" (select by event_id)  
**Compliance Use**: "Export all governance events Jan-Mar 2026" (select by created_at, event_id for ordering)

---

## Identity Usage Matrix

| Identifier | Phase | Generated | Propagated | Unique | Semantic |
|-----------|-------|-----------|-----------|--------|----------|
| trace_id | 2A+ | Client or service | All boundaries | Per request | Workflow lineage |
| correlation_id | 2A+ | Client or service | All boundaries | Per operation | Causal chain |
| input_fingerprint | 2A | RGE | Logs only | Per semantic request | Request normalization |
| decision_fingerprint | 2B | RGE | Logs + audit | Per (request, policy, decision) | Evaluation result |
| authorization_id | 2B | Approval system | Logs + audit | Per grant | Permission grant |
| event_id | 2A Step 5 | Audit service | Audit table | Per log entry | Audit record |

---

## Critical: Forensic Reconstruction Depends on This

**Example: "Investigate request from 3 months ago"**

```
1. Find the trace_id from production logs (2026-02-28)
2. Find all related events by trace_id
3. Find the decision_fingerprint for that request
4. Retrieve historical policy snapshot (from decision_fingerprint)
5. Retrieve authorization_id if approval was required
6. Check if authorization still valid (authorization table + revocation status)
7. If disputed: replay decision with historical policy
   (only works if input_fingerprint matches and normalization was stable)
8. Generate compliance report with event_ids for immutable proof

WITHOUT distinct identifiers:
- Can't distinguish request normalization from policy version
- Can't separate approval grant from decision
- Can't prove audit trail is immutable
- Forensics become impossible
```

---

## Implementation Checklist

### Phase 2A (CURRENT)
- [x] trace_id generation + propagation
- [x] correlation_id generation + propagation
- [x] input_fingerprint (deterministic request hash)
- [x] decision_id (currently called, but semantically a decision_fingerprint)
- [ ] Semantic logging (decision_fingerprint instead of decision_id in logs)

### Phase 2A Step 5
- [ ] event_id generation in audit service
- [ ] Immutable audit table with event_id
- [ ] Append-only constraint (no UPDATE/DELETE)

### Phase 2B
- [ ] Rename decision_id → decision_fingerprint
- [ ] Introduce authorization_id
- [ ] Approval table with authorization lifecycle
- [ ] Revocation handling (new record, not update)

### Phase 2C
- [ ] Fine-grained resource fingerprints
- [ ] Capability scope identifiers
- [ ] Policy version identifiers

---

## References

- GOVERNANCE_SEMANTIC_IDENTIFIERS.md (this document)
- PHASE_2A_PRE_CUTOVER_REQUIREMENTS.md (Requirement 6)
- runtime-governance-engine.ts (implementation)
- decision-model.ts (type definitions)

---

## Summary

**Keep these distinct**:
- `trace_id` = workflow lineage (crossing service boundaries)
- `correlation_id` = causal relationships (across retries/cascades)
- `input_fingerprint` = request normalization (for forensic grouping)
- `decision_fingerprint` = evaluation under policy (for compliance replays)
- `authorization_id` = permission grant (for approval tracking)
- `event_id` = audit immutability (for compliance proof)

**Future debugging quality depends on this semantic clarity now.**
