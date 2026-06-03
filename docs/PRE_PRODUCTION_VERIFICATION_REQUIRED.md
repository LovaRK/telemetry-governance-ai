# Dashboard Pre-Production Verification — BLOCKING ISSUES

**Date**: 2026-06-03  
**Status**: HALT — Do not push data or demo without resolving these

---

## Summary

The dashboard has **semantic correctness issues**: widgets that appear authoritative but whose underlying meaning is unclear or unimplemented. This requires verification before production.

---

## Critical Issues (Block Production Data Onboarding)

### Issue 1: Security Gaps = 0 (Unimplemented) ❌

**Finding**: The metric is not calculated. It defaults to 0.

**Evidence**:
```typescript
// apps/api/agents/llm-decision-agent.ts line 215
"securityGaps": number,  // In JSON schema

// Line 333
securityGaps: p.securityGaps ?? 0,  // Defaults to 0 if missing

// SYSTEM_PROMPT (lines 113-137)
// NO mention of how to calculate security gaps
// NO context about MITRE coverage
// NO instructions to count unmapped sourcetypes
```

**Test**: `grep -r "security.*gap" tests/ → no results`

**Impact**: Dashboard shows "Security Gaps: 0" but this is fake.

**Action Required**:
1. Query database: `SELECT security_gaps FROM executive_kpis ORDER BY created_at DESC LIMIT 1;`
2. If all zeros: Are they unimplemented (confirm ✅) or verified as truly 0?
3. If unimplemented:
   - Option A: Hide the widget
   - Option B: Add label `[BETA] Not yet calculated`
   - Option C: Implement proper calculation in LLM

---

### Issue 2: Operational Gaps = 0 (Unimplemented) ❌

**Finding**: Same as Security Gaps. Unimplemented, defaults to 0.

**Evidence**:
```typescript
// llm-decision-agent.ts line 216
"operationalGaps": number,

// Line 334
operationalGaps: p.operationalGaps ?? 0,  // Defaults to 0 if missing
```

**Test**: `grep -r "operational.*gap" tests/ → no results`

**Impact**: Dashboard shows "Operational Gaps: 0" but this is fake.

**Action Required**: Same as Security Gaps.

---

### Issue 3: Confidence Multiplier Bug — Partially Fixed ⚠️

**What Was Fixed** ✅:
```typescript
// OLD (SourceIntelligenceGrid.tsx line 179)
(s.confidence * 100)%  // Would show 10000% if confidence was 100

// NEW
(s.confidence <= 1 ? s.confidence * 100 : s.confidence)%  // Safe
```

**What's Still Missing** ❌:
```typescript
// Currently: silent capping
// Should add: explicit error logging
if (confidence > 100) {
  logError(`Invalid confidence returned from API: ${confidence}`)
  showWarningBadge("Data integrity issue detected")
}
```

**Why**: If the LLM ever returns 10000 again, a silent cap hides the bug.

---

## High-Risk Issues (Verify Before Demo)

### Issue 4: Queue Health Metrics — Unclear Semantics ⚠️

**Problem**: Component called "Queue Health Metrics" but displays:
- Reuse Ratio
- Filtering Efficiency
- Decision Flip Rate

These are **Pipeline Telemetry**, NOT queue metrics (pending/running/failed jobs).

**Customer Expectation** (Queue Health should show):
```
Pending Jobs: 3
Running Jobs: 1
Completed Jobs: 45
Failed Jobs: 0
Average Processing Time: 2.5 min
Oldest Pending Job: 5 min
```

**Current Display** (Confusing):
```
Reuse Ratio: 87.3%
Filtering Efficiency: 8.2%
Decision Flip Rate: 1.1%
```

**Questions**:
- [ ] What is "Reuse Ratio" actually measuring?
- [ ] What is "Filtering Efficiency" actually measuring?
- [ ] Are these calculated or demo values?
- [ ] What API endpoint backs this?

**Action Required**:
- Option A: Rename to "Pipeline Telemetry"
- Option B: Verify these ARE queue metrics and document what they mean
- Option C: Hide until implemented correctly

**Recommendation**: Rename to **"Pipeline Telemetry"** and add explanatory banner.

---

### Issue 5: Decision Review Queue — Unverified Workflow ⚠️

**Problem**: Component shown but unclear if real or alpha.

**Questions**:
- [ ] What table/API backs this? (`/api/decision-lineage`)
- [ ] What creates review items?
- [ ] What triggers a decision to appear?
- [ ] Is there a confidence threshold?
- [ ] When was this last tested?

**Action Required**:
1. If NOT ready: Hide the widget or add `[ALPHA]` label
2. If ready: Document the workflow clearly

**Recommendation**: Add explicit help text or hide.

---

### Issue 6: Pipeline Health — Vague Terms ⚠️

**Current** (Vague):
```
Model Health Monitor
Model Trust Score: 94%
System Health Status: HEALTHY
```

**Should Be Specific** (Measurable):
```
Pipeline Health
├─ Splunk Connection: Connected
├─ Last Refresh: 2 minutes ago
├─ Failed Refresh Jobs (24h): 0
├─ Current Pipeline State: Idle
└─ Queue Depth: 0
```

**Why**: "Model Health" and "Trust Score" without definitions look authoritative but aren't specific.

**Action Required**: Replace with concrete measured values.

---

## Pre-Production Checklist

### Check A: Verify Source Values
```sql
SELECT 
  security_gaps,
  operational_gaps,
  avg_confidence,
  created_at
FROM executive_kpis
ORDER BY created_at DESC
LIMIT 5;
```

**Pass Criteria**: 
- [ ] Values are non-zero OR explicitly documented as "not yet calculated"
- [ ] avg_confidence is 0-100, not 0-1
- [ ] Timestamps are recent (within 24h)

### Check B: Verify API Response
```bash
curl http://localhost:3000/api/executive-summary \
  -H "x-tenant-id: default" \
  -H "x-user-id: test" \
  -H "x-user-role: admin"
```

**Pass Criteria**:
- [ ] Response includes all KPIs
- [ ] Values match database (no calculation errors)
- [ ] No null values for required metrics
- [ ] Confidence is 0-100, not 10000

### Check C: Verify UI Display
**Pass Criteria**:
- [ ] All metrics display correctly (no 10000%)
- [ ] Empty metrics show explicit reason (e.g., "Not yet calculated")
- [ ] Hover tooltips explain each metric
- [ ] No vague terms like "Model Health"

### Check D: Verify Semantics
**Pass Criteria**:
- [ ] Security Gaps: If 0, is it verified or unimplemented?
- [ ] Operational Gaps: If 0, is it verified or unimplemented?
- [ ] Queue Health: Are these actually queue metrics?
- [ ] Decision Review: Is this a real workflow?
- [ ] Pipeline Health: Are values actually calculated?

### Check E: Run One Full Refresh
1. Click "Refresh" button
2. Wait for completion
3. Capture:
   - Database values
   - API response
   - UI screenshot
4. Verify: DB → API → UI match exactly

---

## Recommendation

**DO NOT**:
- ❌ Push production data while metrics are unimplemented
- ❌ Show customer a dashboard with undefined metrics
- ❌ Label unimplemented metrics as "real"
- ❌ Hide calculation bugs with silent defaults

**DO**:
- ✅ Hide unimplemented widgets or label them `[BETA]`
- ✅ Rename unclear components (Queue Health → Pipeline Telemetry)
- ✅ Document exactly what each metric measures
- ✅ Verify calculations with actual data before demoing
- ✅ Add error logging for edge cases (confidence > 100)

**Timeline**:
- [ ] Verification: 30 min
- [ ] Fixes: 1-2 hours
- [ ] Re-test: 30 min
- **Total: ~2-3 hours** before demo-ready

---

**Status**: Awaiting verification of the 5 critical questions above.
