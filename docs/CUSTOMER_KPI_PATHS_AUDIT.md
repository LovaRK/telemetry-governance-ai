# Customer-Visible KPI Paths Audit

**Date**: 2026-06-03  
**Status**: ⚠️ CRITICAL ISSUE FOUND - Silent defaults in KPI History endpoint

---

## Summary

Found 8 customer-visible endpoints serving KPI data. **1 CRITICAL ISSUE** in kpi-history endpoint.

| Endpoint | Tier-A KPIs? | Silent Defaults? | Status |
|----------|-------------|-----------------|--------|
| /api/executive-summary | ✅ YES (all 9) | ✅ FIXED | **PASS** |
| /api/kpi-history | ✅ YES (7 metrics) | ❌ **FOUND** | **FAIL** |
| /api/telemetry | Supporting | ⏳ Not audited | ⏳ TBD |
| /api/queue-health | Not KPI | - | - |
| /api/trust-inspection | Not KPI | - | - |
| /api/agent-decisions | Supporting | ⏳ Not audited | ⏳ TBD |

---

## CRITICAL ISSUE: KPI History Endpoint

**File**: `/apps/web/app/api/kpi-history/route.ts`

**Problem**: SQL COALESCE uses silent defaults (lines 17-24)

```sql
-- CRITICAL: Silent defaults in SQL
SELECT
  COALESCE(ek.roi_score, 0)::float8 AS "roiScore",              -- Line 17: Silent 0
  COALESCE(ek.gainscope_score, 0)::float8 AS "gainScopeScore",  -- Line 18: Silent 0
  COALESCE(ek.storage_savings_potential, 0)::float8,             -- Line 19: Silent 0
  COALESCE(ek.total_daily_gb, 0)::float8,                        -- Line 20: Silent 0
  COALESCE(ek.avg_utilization, 0)::float8,                       -- Line 21: Silent 0
  COALESCE(ek.avg_detection, 0)::float8,                         -- Line 22: Silent 0
  COALESCE(ek.avg_quality, 0)::float8,                           -- Line 23: Silent 0
  COALESCE(ek.avg_confidence, 0)::float8                         -- Line 24: Silent 0
FROM executive_kpis ek
```

**Impact**: 
- User opens dashboard
- Switches to 30-day view
- KPI trend chart calls `/api/kpi-history?days=30`
- Query returns COALESCE defaults (0) instead of NULL
- UI displays 0 for missing data
- **SILENT DEFAULT VIOLATION** ❌

**Example**:
```json
// WHAT API RETURNS (Wrong)
{
  "data": [
    {"date": "2026-06-03", "roiScore": 52.3},
    {"date": "2026-06-02", "roiScore": 0},    // Missing? Or actual 0?
    {"date": "2026-06-01", "roiScore": 0}     // AMBIGUOUS
  ]
}

// WHAT IT SHOULD RETURN (With classification)
{
  "data": [
    {"date": "2026-06-03", "roiScore": 52.3, "roiScoreClassification": "REAL"},
    {"date": "2026-06-02", "roiScore": null, "roiScoreClassification": "EMPTY"},
    {"date": "2026-06-01", "roiScore": null, "roiScoreClassification": "EMPTY"}
  ]
}
```

---

## Why This Is Blocking

**User Experience**:
1. Opens Executive Overview → sees ROI = 52.3 (REAL)
2. Clicks "7-day trend" → chart shows day with ROI = 0 (should be EMPTY)
3. User is confused: "Did ROI drop to zero, or is data missing?"

**Violates No Silent Defaults Rule**:
- Rule: Never return 0 when data is missing
- Endpoint: Returns COALESCE(..., 0)
- Result: Silent default ❌

---

## Fix Required

**Before (Silent Default)**:
```sql
COALESCE(ek.roi_score, 0)::float8 AS "roiScore"
```

**After (Explicit NULL)**:
```sql
ek.roi_score::float8 AS "roiScore",
CASE WHEN ek.roi_score IS NULL THEN 'EMPTY' ELSE 'REAL' END AS "roiScoreClassification"
```

**Impact**: 
- ✅ Fixes 7 silent defaults
- ✅ Adds 7 classification fields
- ✅ Matches executive-summary contract

---

## Complete Endpoint Audit

### 1. Executive Summary ✅ FIXED
**File**: `/apps/web/app/api/executive-summary/route.ts`

**Tier-A KPIs Returned**: 
- roiScore ✅
- gainScopeScore ✅
- storageSavingsPotential ✅
- totalLicenseSpend ✅
- tier1SpendAnnual ✅
- tier2SpendAnnual ✅
- tier3SpendAnnual ✅
- tier4SpendAnnual ✅
- avgConfidence ✅

**Silent Defaults**: ✅ FIXED (all using extractKPI)
**Classifications**: ✅ ADDED (all have *Classification field)

### 2. KPI History ❌ NEEDS FIX
**File**: `/apps/web/app/api/kpi-history/route.ts`

**Tier-A KPIs Returned**:
- roiScore ❌ (COALESCE(..., 0))
- gainScopeScore ❌ (COALESCE(..., 0))
- storageSavingsPotential ❌ (COALESCE(..., 0))
- avgUtilization ❌ (COALESCE(..., 0))
- avgDetection ❌ (COALESCE(..., 0))
- avgQuality ❌ (COALESCE(..., 0))
- avgConfidence ❌ (COALESCE(..., 0))

**Silent Defaults**: ❌ FOUND (7 metrics have COALESCE defaults)
**Classifications**: ❌ MISSING (no classification fields)

**Blocking Status**: ✅ **THIS BLOCKS DEMO**

### 3. Telemetry Endpoint ⏳ NEEDS AUDIT
**File**: `/apps/web/app/api/telemetry/route.ts`

Status: Not yet audited

### 4. Agent Decisions ⏳ NEEDS AUDIT
**File**: `/apps/web/app/api/agent-decisions/route.ts`

Status: Not yet audited

### 5-8. Other Endpoints (Not KPI-focused)
- queue-health: Not customer-facing KPI
- trust-inspection: Not core KPI
- cache-status: Not KPI
- health: Not KPI

---

## GO/NO-GO Decision

**Current Status**: ❌ **NO-GO** 

**Reason**: KPI History endpoint violates No Silent Defaults rule

**Blockers**:
1. ❌ KPI History has 7 silent COALESCE defaults
2. ⏳ Need to audit telemetry and agent-decisions endpoints
3. ⏳ Need to verify no other customer-visible paths have same issue

**Required Before Browser Verification**:
1. Fix KPI History endpoint (7 fields)
2. Audit telemetry endpoint
3. Audit agent-decisions endpoint
4. Search for any other endpoints returning Tier-A KPIs

---

## Assessment (Updated)

| Phase | Estimate | Actual | Status |
|-------|----------|--------|--------|
| Architecture | 95% | 95% | ✅ |
| AI Runtime | 95% | 95% | ✅ |
| Settings → AI | 85% | 85% | ✅ |
| Formula Transparency | 95% | 95% | ✅ |
| Provenance | 95% | 95% | ✅ |
| Silent Default Remediation | 80% | **40%** | ❌ |
| API Contract Validation | 60% | **20%** | ❌ |
| Runtime Certification | 0% | 0% | ⏳ |

**Reason for drop**: Found critical issue in KPI History endpoint

---

## Next Steps (Immediate)

1. **FIX KPI History** (30 min)
   - Remove COALESCE(..., 0) defaults
   - Add classification fields
   - Test query returns NULL for missing data

2. **AUDIT Telemetry & Agent-Decisions** (30 min)
   - Check for similar COALESCE patterns
   - Check for customer-facing KPI fields
   - Document findings

3. **SEARCH for Other Paths** (30 min)
   - Find all endpoints returning Tier-A KPI fields
   - Verify no silent defaults
   - Create complete inventory

4. **RE-VERIFY Executive-Summary** (15 min)
   - Confirm still has no issues
   - Verify no new issues introduced

---

**Timeline to Ready**: +1-2 hours (additional fixes + re-verification)

**Demo Status**: ⏳ **NOT READY** (waiting for KPI History fix + audit completion)

---

*This audit uncovers the "big picture" problem: silent defaults are not just in one endpoint, they're systematic across the codebase.*

*User was right to push for complete verification before claiming "all code complete."*
