# Policy Engine — Rule-Based Decision Validation

## Overview

The Policy Engine is the **validation layer** between deterministic scores and agent execution. It ensures that agent recommendations comply with:

1. **Hard Guardrails** — Non-negotiable constraints (e.g., cannot eliminate detection-critical sources)
2. **Configurable Rules** — Business logic (e.g., eliminate all Tier 4 sources costing >$1k/year)
3. **Fallback Logic** — Safe alternatives when a recommendation is blocked

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Deterministic Scores (from Engine)                        │
│  + Agent Recommendation (from LLM)                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────────┐
         │  Policy Engine.validate() │
         └────────┬──────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
       ▼                     ▼
   ┌────────────┐      ┌──────────────┐
   │ Guardrails │      │    Rules     │
   │ (7 hard    │      │  (config-    │
   │ constraints)       │   driven)    │
   └────────────┘      └──────────────┘
       │                     │
       └──────────┬──────────┘
                  │
                  ▼
     ┌──────────────────────────┐
     │ Validated Decision       │
     │ + Violations + Warnings  │
     └──────────────────────────┘
                  │
                  ▼
    ┌────────────────────────────────┐
    │ Ready for Agent Execution      │
    │ (or Escalation if blocked)     │
    └────────────────────────────────┘
```

## Guardrails (Hard Constraints)

Default guardrails that **block decisions**:

| ID | Name | Blocks | Condition |
|---|---|---|---|
| `guardrail-detection-threshold` | Detection Coverage | ELIMINATE | detectionScore > 60 |
| `guardrail-critical-utilization` | Critical Usage | ELIMINATE | utilizationScore > 70 |
| `guardrail-quality-unresolved` | Quality Issues | ELIMINATE | qualityScore < 50 |
| `guardrail-tier-critical` | Tier 1 Protection | ELIMINATE | tier === 'Critical' |
| `guardrail-high-cost` | High-Cost Sources | ELIMINATE | annualCostUsd > $50k |
| `guardrail-composite-minimum` | Minimum Composite | ELIMINATE | compositeScore > 55 |
| `guardrail-monitor-quality` | Monitor Quality Bar | MONITOR | qualityScore < 70 |

**How it works:**
- Agent recommends ELIMINATE
- Engine checks all guardrails
- If any guardrail condition is met, recommendation is **blocked**
- Engine finds **fallback decision** (MONITOR → RETAIN → ESCALATE)

## Rules (Configurable Business Logic)

Rules are conditions + decisions. Multiple rules can apply; the highest severity wins.

```typescript
{
  id: 'rule-tier-4-eliminate',
  name: 'Eliminate Tier 4',
  severity: 'MEDIUM',
  conditions: [
    { field: 'tier', operator: 'eq', value: 'Low-Value' },
    { field: 'annualCostUsd', operator: 'gt', value: 1000 }
  ],
  decision: 'ELIMINATE'
}
```

**Conditions use:**
- Operators: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `in`, `not_in`, `contains`
- Fields: `utilizationScore`, `detectionScore`, `qualityScore`, `compositeScore`, `tier`, `annualCostUsd`
- Logic: ALL conditions must match (AND)

## Policies

Pre-defined profiles for different governance styles:

### `cost_optimization`
Aggressive elimination of low-value, unused sources.
- Eliminates Tier 4 sources > $1k/year
- Monitors low utilization (< 20)
- Eliminates stale sources (no activity, composite < 20)

### `security_first`
Retain detection-critical sources, escalate quality issues.
- Retains sources with detection >= 75
- Monitors medium detection (40-75)
- Escalates quality issues (qualityScore < 60)

### `operations_focused` (DEFAULT)
Balance cost and utility, minimize disruption.
- Retains Tier 1-2 (Critical, Important)
- Monitors Tier 3 (Nice-to-Have)
- Rebalances Tier 4 instead of eliminating

### `conservative`
Escalate all non-monitoring decisions.
- Only MONITOR and ESCALATE allowed
- Everything else blocked

### `data_quality`
Resolve quality issues before any action.
- Flags quality < 70 for remediation
- Only allows optimization on quality >= 70 sources

## Usage

### Basic Validation

```typescript
import { PolicyEngine, createDefaultPolicyEngine } from '@core/policy';

// Create engine with default guardrails
const engine = createDefaultPolicyEngine();

// Validate a recommendation
const result = engine.validateRecommendation(
  {
    index: 'security_events',
    sourcetype: 'auth',
    utilizationScore: 45,
    detectionScore: 80,
    qualityScore: 85,
    compositeScore: 72,
    tier: 'Critical',
    annualCostUsd: 25000
  },
  {
    index: 'security_events',
    recommendedDecision: 'ELIMINATE',
    confidence: 0.72,
    reasoning: 'Low utilization despite good scores'
  }
);

// Result
console.log(result.validatedDecision); // ESCALATE (blocked by guardrail-tier-critical)
console.log(result.violations); // [{ ruleId: 'guardrail-tier-critical', ... }]
console.log(result.isValid); // false
```

### With Policy Profile

```typescript
import { PolicyEngine, getPolicyByProfile } from '@core/policy';

const config = getPolicyByProfile('cost_optimization');
const engine = new PolicyEngine(config);

const result = engine.validateRecommendation(scored, recommendation);
```

### Batch Validation

```typescript
const results = engine.validateBatch(scoredArray, recommendationsArray);

// Summarize
const violations = results.filter(r => !r.isValid).length;
const escalations = results.filter(r => r.validatedDecision === 'ESCALATE').length;
```

### Runtime Config Updates

```typescript
// Update rules without restarting
const newRules = [{ /* ... */ }];
engine.updateRules(newRules);

// Update guardrails
const newGuardrails = [{ /* ... */ }];
engine.updateGuardrails(newGuardrails);
```

## Integration with Aggregation Service

The `policy-engine-adapter.ts` provides a safe pipeline:

```typescript
import { runPolicyValidationPipeline } from '@infra/aggregation/policy-engine-adapter';

const result = await runPolicyValidationPipeline(
  scored,           // From deterministic engine
  recommendations,  // From LLM agent
  'operations_focused'  // Policy profile
);

// Output
console.log(result.validations);      // All validations with violations
console.log(result.decisions);        // Validated decisions only
console.log(result.executionPayload); // Ready for agent execution
console.log(result.auditTrail);       // Compliance audit trail
```

## Decision Fallback Hierarchy

When a decision is blocked by guardrails, the engine tries alternatives in order:

```
Recommended Decision (e.g., ELIMINATE)
  ↓ [blocked by guardrail?]
  ↓
Fallback 1: MONITOR
  ↓ [still blocked?]
  ↓
Fallback 2: RETAIN
  ↓ [still blocked?]
  ↓
Fallback 3: ESCALATE
  ↓ [still blocked?]
  ↓
Fallback 4: REBALANCE
  ↓ [still blocked?]
  ↓
Final: ESCALATE (always safe)
```

## Decision Meanings

| Decision | Purpose | When |
|---|---|---|
| **ELIMINATE** | Remove source from Splunk | Low composite + no critical signals |
| **RETAIN** | Keep as-is | Strategic/critical/detection-heavy |
| **MONITOR** | Observe before decision | Medium scores, needing validation |
| **ESCALATE** | Flag for approval | High risk, violations, or uncertain |
| **REBALANCE** | Consolidate/optimize | Low-value but not safe to eliminate |

## Testing

### Test a Guardrail

```typescript
import { createDefaultGuardrails, checkGuardrailViolations } from '@core/policy';

const guardrails = createDefaultGuardrails();
const violations = checkGuardrailViolations(
  { detectionScore: 75, ... },
  'ELIMINATE',
  guardrails
);

assert(violations.length > 0, 'Should block ELIMINATE for high detection');
```

### Test a Rule

```typescript
import { evaluateRule } from '@core/policy';

const rule = { /* ... */ };
const matches = evaluateRule(scored, rule);
assert(matches === true, 'Rule should match this input');
```

## Audit Trail

Every validation generates an audit trail for compliance:

```typescript
const auditTrail = generatePolicyAuditTrail(validations, 'cost_optimization');

// Output
{
  timestamp: 2026-05-18T...,
  profile: 'cost_optimization',
  totalValidations: 247,
  decisions: {
    'security_events::auth': {
      recommended: 'ELIMINATE',
      validated: 'ESCALATE',
      isValid: false,
      appliedRules: ['guardrail-tier-critical']
    },
    ...
  },
  violations: {
    'security_events::auth': [
      {
        ruleId: 'guardrail-tier-critical',
        severity: 'CRITICAL',
        violation: 'Source is Tier 1 (Critical)...'
      }
    ]
  }
}
```

## Custom Guardrails

Create tenant-specific constraints:

```typescript
import { createCustomGuardrail } from '@core/policy';

const customGuardrail = createCustomGuardrail(
  'guardrail-compliance-pci',
  'PCI Compliance Sources',
  'Cannot eliminate sources tagged for PCI compliance',
  (input) => input.index.startsWith('pci_'),
  'ELIMINATE',
  'Source is tagged for PCI compliance — cannot eliminate'
);
```

## Next Steps

1. **Event Bus** (Step 5) — Async workers consume validated decisions
2. **Agent Layer** — Executes validated decisions with approval routing
3. **Observability** — Track decision acceptance/rejection rates
4. **Multi-tenancy** — Per-tenant policy overrides
