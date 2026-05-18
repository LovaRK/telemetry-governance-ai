# GovernanceTelemetryEnvelopeV1 — Frozen Contract

**Status:** PRODUCTION FROZEN — Versioned for stable consumer integration  
**Version:** 1.0  
**Effective Date:** 2026-05-18  
**Next Review:** 2026-08-18 (quarterly)

---

## Purpose

`GovernanceTelemetryEnvelopeV1` is the immutable contract for all governance telemetry events. It defines:
- **What** governance state changes are observable (five trust domains)
- **How** they're cryptographically authenticated (HMAC signature + OperatorTraceBinding)
- **When** they were emitted (ISO8601 timestamps, deployment epochs)
- **Who** authorized them (operator session snapshot + authorization context)

The envelope is **frozen** to ensure dashboard code never needs updates for schema changes.

---

## Schema Definition

### Core Identity

| Field | Type | Immutable | Purpose |
|-------|------|-----------|---------|
| `envelopeId` | UUID (hex) | YES | Globally unique envelope identifier |
| `schemaVersion` | '1.0' | YES | Contract version (frozen at 1.0) |
| `traceId` | string | YES | Distributed trace identifier |
| `spanId` | string | YES | Span within trace |

### Cryptographic Integrity

| Field | Type | Immutable | Purpose |
|-------|------|-----------|---------|
| `envelopeSignature` | string (SHA256 hex) | YES | HMAC-SHA256(canonicalize(envelope), serviceSecret) |
| `operatorTraceBinding` | OperatorTraceBinding? | YES | Human approval or escalation (if applicable) |

**Signature Verification:** All consumers MUST verify the envelope signature using the service secret before consuming any fields.

```typescript
import { verifyEnvelopeSignature } from '@types/governance-telemetry-envelope';

if (!verifyEnvelopeSignature(envelope, SERVICE_SECRET)) {
  throw new Error('Envelope signature verification failed');
}
```

### Trust Domains (Five-Point Decomposition)

| Domain | Score Range | Meaning | Updated By |
|--------|-------------|---------|------------|
| **STRUCTURAL** | [0, 1] | Data extraction quality + schema consistency | Phase 6.1.5A.1 validator |
| **PROPAGATION** | [0, 1] | Trace boundary crossing fidelity | BoundaryEvidence adapter |
| **AUTOMATION** | [0, 1] | Confidence in autonomous action soundness | AutomationDirective gate |
| **IDENTITY** | [0, 1] | Confidence in user/tenant identification | Token + RBAC validation |
| **OBSERVABILITY** | [0, 1] | Freshness + coherence tier (data staleness) | Topology epoch + cache age |

Each trust domain includes:
- `score`: Float in [0, 1]
- `lastEvaluatedAt`: ISO8601 timestamp of most recent assessment
- `evaluationMethod`: Semantic identifier (e.g., 'PHASE_6_1_5A_1_1', 'PROPAGATION_CONFIDENCE')
- `composition`: Optional breakdown by sub-component (e.g., extractionRate, alsIntegrity)

### Automation Authority

| Field | Type | Meaning |
|-------|------|---------|
| `automationDirective.scope` | 'FULL_AUTOMATION' \| 'SUGGEST_ONLY' \| 'ESCALATION_ONLY' | What actions are permitted |
| `automationDirective.requiresApproval` | boolean | Human approval needed? |
| `automationDirective.confidenceThreshold` | [0, 1] | Min trust score for automation |
| `automationDirective.appliedAt` | ISO8601 | When directive took effect |

**CRITICAL:** Replays cannot use `FULL_AUTOMATION` scope (see FIX 4).

### Observability & Topology

| Field | Type | Purpose |
|-------|------|---------|
| `coherenceTier` | 'COLD' \| 'WARM' \| 'HOT' | Data freshness (see table below) |
| `topologyEpoch` | number | Increments on deployment; correlates with service versions |
| `emittedAt` | ISO8601 | When envelope was generated |
| `emittedBy` | string | Which service/component? (e.g., 'governance-causality-engine') |
| `ttlSeconds` | number? | Optional cache expiry |

#### Coherence Tiers

| Tier | Freshness | Reason Example | Action |
|------|-----------|-----------------|--------|
| **HOT** | < 5 minutes | Real-time telemetry | Safe for automation |
| **WARM** | 5-60 minutes | Recently cached | Requires review for high-risk |
| **COLD** | > 60 minutes | Stale data | Escalation required |

---

## Immutability Principles

### Why Frozen?

1. **Dashboard Stability:** Consumers (dashboards, replay engines, audit systems) are deployed independently. Schema changes require coordinated rollouts across all consumers.

2. **Cryptographic Binding:** The envelope signature is computed over the full canonical JSON. Adding or removing fields breaks verification.

3. **Time-Travel Auditability:** Historical envelopes must remain verifiable indefinitely. Versioning enables this.

### What "Frozen" Means

- **Allowed:** Add **new optional fields** (with backward-compatible defaults)
- **Not Allowed:**
  - Remove or rename fields (breaks existing consumers)
  - Change field types (e.g., `score` from number → string)
  - Change envelope signature semantics
  - Restructure trust domains

### Adding New Fields

If a new concept emerges (e.g., "geo-distribution confidence"):

1. **Propose in ADR** with rationale, target consumer, default value
2. **Create new version** (e.g., v1.1, v2.0) with deprecation path
3. **Emit both versions** for transition period (90 days suggested)
4. **Sunset old version** after all consumers upgraded

**Version Migration Example:**

```typescript
// v1.0
interface GovernanceTelemetryEnvelopeV1 {
  trustDomains: { structural, propagation, automation, identity, observability };
}

// v1.1 (proposed)
interface GovernanceTelemetryEnvelopeV1_1 extends GovernanceTelemetryEnvelopeV1 {
  trustDomains: GovernanceTelemetryEnvelopeV1['trustDomains'] & {
    geoDistribution?: TrustDomainSnapshot; // NEW, optional
  };
}

// Migration service emits both during transition
emitEnvelopeV1(envelope); // Old consumers
emitEnvelopeV1_1(envelope); // New consumers
```

---

## Consumer Responsibility

### Verification Checklist

Every consumer MUST:

- [ ] Verify envelope signature before consuming any field
- [ ] Check `schemaVersion` is '1.0' (fail if not)
- [ ] Validate trust domain scores are in [0, 1]
- [ ] Validate `emittedAt` is valid ISO8601
- [ ] Verify `operatorTraceBinding` signature if present
- [ ] Honor `coherenceTier` when deciding automation risk

### Error Handling

```typescript
const result = verifyGovernanceTelemetryEnvelope(envelope, SERVICE_SECRET);
if (!result.valid) {
  logger.error('Invalid envelope', { errors: result.errors, envelopeId: envelope.envelopeId });
  // Emit incident alert to on-call
  // Fail closed: do NOT use this envelope
  throw new Error('Governance envelope verification failed');
}
```

---

## Versioning Strategy

### SemVer-Like Approach

- **v1.0** → Current frozen version
- **v1.1+** → Non-breaking additions (new optional fields)
- **v2.0** → Breaking changes (requires all consumers upgrade in coordination)

### Support Lifecycle

- **v1.0:** PRODUCTION (until v2.0 released + 90-day migration window)
- **v2.0:** Released only after 3-month ADR review + stakeholder consensus

---

## Registry of Evaluation Methods

Consumers can filter by evaluation method to understand **how** a score was calculated.

| Method | Introduced | Component | Meaning |
|--------|-----------|-----------|---------|
| `PHASE_6_1_5A_1_1` | 2026-05-18 | STRUCTURAL | Trace completeness validator (5 failure modes tested) |
| `PROPAGATION_CONFIDENCE` | 2026-05-18 | PROPAGATION | Boundary evidence confidence scoring |
| `REPLAY_NONCE_VALIDATION` | 2026-05-18 | IDENTITY | Replay authorization nonce check |
| `ABSOLUTE_SESSION_LIFETIME` | 2026-05-18 | IDENTITY | Token family max lifetime check (30d) |
| `COHERENCE_TIER_ASSESSMENT` | 2026-05-18 | OBSERVABILITY | Freshness-based data staleness tier |

---

## Testing & Validation

### Contract Compliance Test

All telemetry emission code must pass:

```bash
npm test apps/api/__tests__/security-fixes.integration.test.ts
# Covers: envelope signature, trust domain validation, timestamp correctness
```

### Runtime Validation

Every emitted envelope goes through:

1. **Schema validation:** All required fields present
2. **Type validation:** Trust scores in [0, 1], timestamps are valid ISO8601
3. **Signature computation:** HMAC over canonical JSON
4. **Audit logging:** Envelope persisted for forensic replay

---

## Historical Reference

| Date | Change | Reason |
|------|--------|--------|
| 2026-05-18 | v1.0 frozen | Foundation complete: 5 trust domains, HMAC signature, OperatorTraceBinding, coherence tiers, automation directive |

---

## Questions?

**Contact:** Architecture Review Board (quarterly review cycle)  
**ADR Location:** `/docs/ADRs/` (versioning proposals)  
**Implementation:** `apps/api/types/governance-telemetry-envelope.ts`  
**Tests:** `apps/api/__tests__/security-fixes.integration.test.ts`
