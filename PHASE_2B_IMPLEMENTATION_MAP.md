# Phase 2B Implementation Map

## Files Created & Modified

### Database Layer ✓

| File | Type | Status | Purpose |
|------|------|--------|---------|
| `/infrastructure/migrations/119_control_plane_unified_event_ledger.sql` | Migration | ✅ CREATED | Event schema, idempotency constraints, monotonic trigger |
| `/core/database/pipeline-events.ts` | Core API | ✅ CREATED | Event emission, timeline queries, idempotency handling |
| `/core/database/connection.ts` | Connection | ✅ EXISTING | PostgreSQL connection pool (updated for new schema) |

### Policy Engine ✓

| File | Type | Status | Purpose |
|------|------|--------|---------|
| `/core/governance/policy-engine-events.ts` | Core | ✅ MODIFIED | Added `approveOperatorDecision()` function for Seq 3 |

**New Export:**
```typescript
export async function approveOperatorDecision(
  executionId: string,
  operatorSessionId: string,
  approvalReason?: string
): Promise<{ status: 'APPROVED'; executionId: string; sequenceNumber: number }>
```

### Backend APIs ✓

| File | Type | Status | Purpose |
|------|------|--------|---------|
| `/apps/web/app/api/governance/events/stream/route.ts` | Next.js API | ✅ CREATED | SSE endpoint with historical bootstrap + 1s polling |
| `/apps/web/app/api/governance/executions/[execution_id]/timeline/route.ts` | Next.js API | ✅ CREATED | Timeline replay with integrity auditing |

### Frontend Components ✓

| File | Type | Status | Purpose |
|------|------|--------|---------|
| `/apps/web/components/GovernanceEventTimeline.tsx` | React | ✅ CREATED | Event timeline UI with bootstrap+stream deduplication |

### Verification ✓

| File | Type | Status | Purpose |
|------|------|--------|---------|
| `/scripts/verify-policy-events.ts` | Test Script | ✅ MODIFIED | Added operator approval cascade test (Seq 3) |

---

## Implementation Checklist

### 1. Event Storage Foundation ✓
- [x] Create `pipeline_executions` table (master state machine)
- [x] Create `pipeline_events` table (immutable ledger)
- [x] Add UNIQUE constraints for idempotency:
  - [x] `(execution_id, sequence)` — prevent duplicate sequences
  - [x] `(execution_id, event_id)` — prevent duplicate event IDs
- [x] Add monotonic trigger — enforce sequence > previous sequence
- [x] Add indexes for query performance:
  - [x] `(correlation_id)` — distributed tracing
  - [x] `(taxonomy, severity)` — filtering
  - [x] `(timestamp DESC)` — chronological queries

### 2. Event Emission API ✓
- [x] `createExecution()` — Bootstrap execution anchor with UUID generation
- [x] `emitPipelineEvent()` — Append event with sequence validation
- [x] `emitPipelineEventBatch()` — Atomic multi-event emission
- [x] `getExecutionTimeline()` — Deterministic replay in sequence order
- [x] `getRecentEventsByTaxonomy()` — Real-time event filtering
- [x] `buildGovernanceMetadata()` — Structured governance annotation
- [x] Error handling — Graceful idempotent duplicate detection

### 3. Policy Engine Integration ✓
- [x] **VECTOR A (CRITICAL):** `POLICY_ENFORCEMENT_BLOCKED` terminal event
  - [x] Seq 1: `POLICY_VALIDATION_EXECUTED` with reasoning
  - [x] Seq 2: `POLICY_ENFORCEMENT_BLOCKED` with `CRITICAL` severity
  - [x] Hard stop — execution stage set to `FAILED`
- [x] **VECTOR B (HIGH):** `POLICY_APPROVAL_REQUIRED` human gate
  - [x] Seq 1: `POLICY_VALIDATION_EXECUTED` with reasoning
  - [x] Seq 2: `POLICY_APPROVAL_REQUIRED` with `WARN` severity
  - [x] Execution stage set to `DECISION_GATE` (paused)
- [x] **NEW:** Operator approval cascade
  - [x] `approveOperatorDecision()` function
  - [x] Seq 3: `OPERATOR_APPROVAL_GRANTED` event
  - [x] Actor tracking: `operator:session_id`
  - [x] Approval reason in payload
  - [x] Execution stage set to `EXECUTING`

### 4. SSE Streaming ✓
- [x] Historical bootstrap phase:
  - [x] Fetch full timeline if `execution_id` provided
  - [x] Stream all matching events with `_source: 'HISTORICAL'`
  - [x] Apply taxonomy/severity filters
- [x] Real-time polling phase:
  - [x] Poll every 1 second for new events
  - [x] Track `lastSeenSequence` for deduplication
  - [x] Stream new events with `_source: 'REALTIME'`
  - [x] Graceful shutdown on client disconnect
- [x] Keep-alive mechanism:
  - [x] Send `KEEP_ALIVE` ping if no execution_id
  - [x] Prevent connection idle timeout
- [x] Dynamic filtering:
  - [x] `?taxonomy=POLICY,OPERATOR` support
  - [x] `?severity=CRITICAL,WARN` support
  - [x] Comma-separated list parsing

### 5. Timeline Replay ✓
- [x] Full event history retrieval:
  - [x] Ordered by sequence ASC
  - [x] All metadata preserved (payload, governance, actor)
- [x] Sequence integrity auditing:
  - [x] Detect gaps: `sequence[i] != sequence[i-1] + 1`
  - [x] Detect duplicates: `sequence[i] == sequence[i-1]`
  - [x] Detect out-of-order: `sequence[i] < sequence[i-1]`
  - [x] Set status to `INTEG_OK` or `INTEG_COMPROMISED_*`
- [x] Response metadata:
  - [x] execution_id, correlation_id
  - [x] total_events, duration_ms
  - [x] first_event_at, last_event_at
  - [x] timeline_integrity_status
  - [x] integrity_details with sequences_verified array

### 6. Frontend Component ✓
- [x] Two-phase initialization:
  - [x] Bootstrap phase: fetch full timeline via `/api/governance/executions/{id}/timeline`
  - [x] Stream phase: connect EventSource to `/api/governance/events/stream`
- [x] Event rendering:
  - [x] Timestamp formatting with `toLocaleTimeString()`
  - [x] Event type as colored badge (severity-based)
  - [x] Sequence number display
  - [x] Live indicator for `_source: 'REALTIME'`
  - [x] Message text rendering
  - [x] Actor metadata display
  - [x] Governance metadata (policies, rollback info)
- [x] Deduplication:
  - [x] Check if `event.sequence` already in state before adding
  - [x] Re-sort after insertion to maintain order
- [x] Integrity status:
  - [x] Header badge showing `INTEG_OK` (green) or `INTEG_COMPROMISED_*` (red)
  - [x] Loading state with spinner
  - [x] Error state with alert box
- [x] Footer summary:
  - [x] Total events count
  - [x] Duration calculation (last - first timestamp)
  - [x] Sequence integrity status

### 7. Verification Tests ✓
- [x] **VECTOR A:** Compliance violation
  - [x] Input: `DISABLE_PCI_LOGS`
  - [x] Expected: `BLOCKED` status + `CRITICAL` risk level
  - [x] Verify: Seq 1 → Seq 2 (terminal)
  - [x] Assert: `timelineA.length === 2`
  - [x] Assert: `timelineA[1].event_type === 'POLICY_ENFORCEMENT_BLOCKED'`
- [x] **VECTOR B:** Cost proposal + operator override
  - [x] Input: `DROP_PROD_SPANS`
  - [x] Expected: `APPROVAL_REQUIRED` status + `HIGH` risk level
  - [x] Initial: Seq 1 → Seq 2 (human gate)
  - [x] Operator approval: Emit Seq 3
  - [x] Final: `EXECUTING` status
  - [x] Verify: Seq 1 → Seq 2 → Seq 3 (complete cascade)
  - [x] Assert: `timelineB.length === 3`
  - [x] Assert: `timelineB[2].event_type === 'OPERATOR_APPROVAL_GRANTED'`
  - [x] Assert: Actor is `operator:session_operator_alice`

---

## Code Examples: Key Patterns

### Creating & Emitting Events
```typescript
// Bootstrap execution
const executionId = await createExecution({
  correlation_id: 'trace-abc-123',
  policy_profile: 'cost_optimization'
});

// Emit Seq 1: validation
await emitPipelineEvent({
  execution_id: executionId,
  correlation_id: 'trace-abc-123',
  sequence: 1,
  event_type: 'POLICY_VALIDATION_EXECUTED',
  taxonomy: 'POLICY',
  severity: 'WARN',
  message: 'Evaluating cost optimization proposal...',
  actor: 'engine:policy_containment'
});

// Emit Seq 2: decision
await emitPipelineEvent({
  execution_id: executionId,
  correlation_id: 'trace-abc-123',
  sequence: 2,
  event_type: 'POLICY_APPROVAL_REQUIRED',
  taxonomy: 'POLICY',
  severity: 'WARN',
  message: 'Human approval required...',
  governance: buildGovernanceMetadata({
    matched_policies: ['HIGH_RISK_OPERATION'],
    requires_approval: true,
    rollback_available: true
  })
});

// Emit Seq 3: operator approval
const approval = await approveOperatorDecision(
  executionId,
  'session_operator_alice',
  'Cost justification approved'
);
// Automatically retrieves correlation_id, emits Seq 3, updates execution stage
```

### Fetching Timeline (Frontend)
```typescript
const timeline = await fetch(`/api/governance/executions/${executionId}/timeline`)
  .then(r => r.json());

console.log({
  events: timeline.timeline.length,  // 3
  integrity: timeline.timeline_integrity_status,  // "INTEG_OK"
  duration: timeline.duration_ms,  // 5000
  sequences: timeline.integrity_details.sequences_verified  // [1, 2, 3]
});
```

### Streaming Events (Frontend)
```typescript
const eventSource = new EventSource(
  `/api/governance/events/stream?execution_id=${executionId}&taxonomy=POLICY,OPERATOR`
);

eventSource.addEventListener('CONTROL_PLANE_UPDATE', (e) => {
  const event = JSON.parse(e.data);
  console.log({
    sequence: event.sequence,
    type: event.event_type,
    source: event._source,  // 'HISTORICAL' or 'REALTIME'
    actor: event.actor
  });
});
```

---

## Database State After Verification

### Table: pipeline_executions
```
execution_id              | correlation_id           | current_stage | actor | status
──────────────────────────┼──────────────────────────┼───────────────┼───────┼────────
3173bf06-1cb6-45e7-9f43   | (correlation_id_A)       | FAILED        | ...   | BLOCKED
e5c97123-277c-4e8c-b0d3   | (correlation_id_B)       | EXECUTING     | ...   | APPROVED
```

### Table: pipeline_events (Sample Rows)
```
sequence | execution_id           | event_type                    | taxonomy | severity | _source
─────────┼────────────────────────┼───────────────────────────────┼──────────┼──────────┼─────────
1        | 3173bf06-1cb6-45e7...  | POLICY_VALIDATION_EXECUTED    | POLICY   | CRITICAL | LEDGER
2        | 3173bf06-1cb6-45e7...  | POLICY_ENFORCEMENT_BLOCKED    | POLICY   | CRITICAL | LEDGER
         |                        |                               |          |          |
1        | e5c97123-277c-4e8c...  | POLICY_VALIDATION_EXECUTED    | POLICY   | WARN     | LEDGER
2        | e5c97123-277c-4e8c...  | POLICY_APPROVAL_REQUIRED      | POLICY   | WARN     | LEDGER
3        | e5c97123-277c-4e8c...  | OPERATOR_APPROVAL_GRANTED     | OPERATOR | INFO     | LEDGER
```

---

## Testing Coverage

**Verification Test:** `/scripts/verify-policy-events.ts`

```bash
npx ts-node scripts/verify-policy-events.ts
```

**Output Snapshot:**
```
[VECTOR A] The Exploit Payload
✓ Evaluation completed
  Status: BLOCKED
  Risk Level: CRITICAL
  Execution ID: 3173bf06-1cb6-45e7-9f43-b3e8ea1c9698

Event Timeline (Monotonic Sequence):
  [Seq 1] POLICY_VALIDATION_EXECUTED
    Taxonomy: POLICY | Severity: CRITICAL
    Message: Governance Engine evaluating DISABLE_PCI_LOGS...

  [Seq 2] POLICY_ENFORCEMENT_BLOCKED
    Taxonomy: POLICY | Severity: CRITICAL
    Message: Policy Engine BLOCKED autonomous execution...
    Policies: COMPLIANCE_HARD_STOP

[VECTOR B] The Cost Proposal
✓ Evaluation completed
  Status: APPROVAL_REQUIRED
  Risk Level: HIGH
  Execution ID: e5c97123-277c-4e8c-b0d3-220cff814a59

Event Timeline (Initial):
  [Seq 1] POLICY_VALIDATION_EXECUTED
  [Seq 2] POLICY_APPROVAL_REQUIRED

[CASCADE] Operator Grants Authorization
✓ Approval granted
  Status: APPROVED
  Sequence: 3

Event Timeline (Post-Approval):
  [Seq 1] POLICY_VALIDATION_EXECUTED
  [Seq 2] POLICY_APPROVAL_REQUIRED
  [Seq 3] OPERATOR_APPROVAL_GRANTED
    Actor: operator:session_operator_alice

VERIFICATION SUMMARY
✓ VECTOR A (Compliance Violation): ALL CHECKS PASSED
✓ VECTOR B (Cost Proposal + Operator Override): ALL CHECKS PASSED

Overall: ALL VECTORS PASSED ✓
```

---

## Architecture Diagram: Complete Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        GOVERNANCE CONTROL PLANE                          │
└──────────────────────────────────────────────────────────────────────────┘

1. DECISION SUBMISSION
   ↓
   [executePolicyEvaluation()] ← User/API request
   ↓
   createExecution() ────────→ pipeline_executions table
   ↓

2. POLICY EVALUATION
   ↓
   emitPipelineEvent(Seq 1) ──→ POLICY_VALIDATION_EXECUTED
   ↓
   [Policy Engine Logic]
   ├─ VECTOR A: Hard block → sequence 2
   ├─ VECTOR B: Approval gate → sequence 2
   └─ VECTOR C: Auto-approve → sequence 2
   ↓
   emitPipelineEvent(Seq 2) ──→ Terminal event
   ↓
   updateExecutionStage() ──→ FAILED | DECISION_GATE | EXECUTING
   ↓

3. OPERATOR DECISION (for VECTOR B only)
   ↓
   [Operator reviews in UI]
   ↓
   approveOperatorDecision()
   ├─ Retrieve execution timeline
   ├─ Emit Seq 3: OPERATOR_APPROVAL_GRANTED
   └─ updateExecutionStage() → EXECUTING
   ↓

4. REAL-TIME VISIBILITY
   ┌─────────────┬─────────────┐
   ↓             ↓             ↓
   SSE Stream    Timeline      Frontend
   [1s polling]  Replay API    Component
   │             │             │
   ├─ Bootstrap  ├─ Integrity  └─ Deduplication
   ├─ Polling    │  auditing     Timeline render
   ├- Filtering  └─ Ordered      Integrity badge
   └─ Keep-alive    sequence     Actor tracking

5. AUDIT TRAIL (Compliance/Forensics)
   ↓
   getExecutionTimeline()
   ├─ Sequence: [1, 2, 3]
   ├─ Integrity: INTEG_OK
   ├─ All payloads
   ├─ All governance metadata
   └─ Actor session IDs
```

---

## Performance Characteristics

### Idempotency Guarantees
- **Deduplication:** `UNIQUE(execution_id, sequence)` constraint
- **Retry-safe:** Duplicate event submissions are safely ignored
- **Complexity:** O(1) constraint check at insert time

### Event Ordering
- **Monotonic:** Trigger enforces `sequence[n] > sequence[n-1]`
- **Deterministic:** Always sorted by `sequence ASC`
- **No out-of-order replay risk**

### Query Performance
- **Timeline replay:** O(n) scan on `execution_id`, pre-sorted
- **Recent events:** O(log n) index scan on `(taxonomy, severity, timestamp)`
- **Correlation lookup:** O(1) hash index on `correlation_id`

### SSE Streaming
- **Historical bootstrap:** Single bulk read, paginated if needed
- **Real-time polling:** 1-second interval, filters with `sequence > lastSeenSequence`
- **Memory:** Constant-sized polling window (recent events only)

---

## Integration Points for Phase 3

### Dashboard Integration
- Render `<GovernanceEventTimeline executionId={id} />` on decision detail page
- Subscribe to SSE stream for real-time operator dashboard
- Display operator approval queue with cascade events

### Drift Monitoring
- Emit reconciliation_applied events as new pipeline_events
- Track reconciliation frequency as stability signal
- Alert on high reconciliation volume

### Audit Reports
- Query timeline by correlation_id for distributed trace reconstruction
- Export full event sequence for compliance audits
- Show governance decisions with full provenance

### Operator Session Tracking
- Use `operator_session_id` for anonymizable behavior analysis
- Track operator approval patterns and reasoning
- Measure operator oversight effectiveness

