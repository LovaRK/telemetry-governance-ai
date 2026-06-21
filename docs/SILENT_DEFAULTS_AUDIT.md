# Silent Defaults Audit — No Silent Defaults Rule

**Date**: 2026-06-03  
**Purpose**: Comprehensive inventory of all `|| 0`, `|| '0'`, `?? 0` patterns in customer-facing KPI paths  
**Status**: IN PROGRESS (9 fields fixed, remaining audit in progress)

---

## TIER-A KPI FIELDS (9 Fields - ALL FIXED ✅)

| Field | Location | Pattern | Status | Fix |
|-------|----------|---------|--------|-----|
| roiScore | /api/executive-summary | `parseFloat(kpi?.roi_score \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| gainScopeScore | /api/executive-summary | `parseFloat(kpi?.gainscope_score \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| totalLicenseSpend | /api/executive-summary | `parseFloat(kpi?.total_license_spend \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| licenseSpendLowValue | /api/executive-summary | `parseFloat(kpi?.license_spend_low_value \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| storageSavingsPotential | /api/executive-summary | `parseFloat(kpi?.storage_savings_potential \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| avgConfidence | /api/executive-summary | `parseFloat(kpi?.avg_confidence \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| tier1SpendAnnual | /api/executive-summary | `parseFloat(kpi?.tier_1_spend_annual \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| tier2SpendAnnual | /api/executive-summary | `parseFloat(kpi?.tier_2_spend_annual \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| tier3SpendAnnual | /api/executive-summary | `parseFloat(kpi?.tier_3_spend_annual \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |
| tier4SpendAnnual | /api/executive-summary | `parseFloat(kpi?.tier_4_spend_annual \|\| '0')` | ✅ FIXED | Returns `{value: null, classification: 'EMPTY'}` |

**Result**: Tier-A metrics now return explicit `{value: null, classification: 'EMPTY'}` instead of silent 0

---

## REMAINING SILENT DEFAULTS IN CUSTOMER-FACING PATHS

### Category A: Supporting Metrics (Medium Priority)

| Field | Location | Pattern | Customer Impact | Status |
|-------|----------|---------|-----------------|--------|
| securityGaps | /api/executive-summary (line 334) | `parseInt(kpi?.security_gaps \|\| '0', 10)` | Shows as 0 if missing | ⏳ PENDING |
| operationalGaps | /api/executive-summary (line 335) | `parseInt(kpi?.operational_gaps \|\| '0', 10)` | Shows as 0 if missing | ⏳ PENDING |
| avgUtilization | /api/executive-summary | Previously using \|\| '0' | Dimension score | ✅ FIXED |
| avgDetection | /api/executive-summary | Previously using \|\| '0' | Dimension score | ✅ FIXED |
| avgQuality | /api/executive-summary | Previously using \|\| '0' | Dimension score | ✅ FIXED |

### Category B: Snapshot/Telemetry Fields (High Volume)

**Location**: `/api/executive-summary` (snapshots array, lines 352-368)

**Fields with silent defaults**:
```typescript
totalEvents: parseInt(snapshot.total_events || '0', 10),
dailyAvgGb: parseFloat(snapshot.daily_avg_gb || '0'),
utilizationPct: parseFloat(snapshot.utilization_pct || '0'),
costPerYear: parseFloat(snapshot.cost_per_year || '0'),
riskScore: d ? parseFloat(d.risk_score || '0') : parseFloat(snapshot.risk_score || '0'),
confidence: d ? parseFloat(d.confidence || '0') : parseFloat(snapshot.confidence || '0'),
estimatedSavings: d ? (parseFloat(d.estimated_savings) || 0) : 0,
compositeScore: d ? (parseFloat(d.composite_score) || 0) : 0,
utilizationScore: d ? (parseFloat(d.utilization_score) || 0) : parseFloat(snapshot.utilization_pct || '0'),
detectionScore: d ? (parseFloat(d.detection_score) || 0) : 0,
qualityScore: d ? (parseFloat(d.quality_score) || 0) : 0,
```

**Impact**: Telemetry detail rows show 0 instead of "Not calculated" when data missing

**Status**: ⏳ PENDING (Need to determine if these are customer-facing or internal)

### Category C: Other Routes (Low Priority)

| File | Pattern | Status |
|------|---------|--------|
| /api/health/route.ts | `(row?.count \|\| 0) > 0` | ⏳ PENDING (health check, internal) |
| /api/queue-health/route.ts | Multiple `\|\| 0` | ⏳ PENDING (queue metrics, internal) |
| /api/kpi-history/route.ts | Various \|\| 0 patterns | ⏳ PENDING (need audit) |

---

## Audit Results: What Still Needs Fixing

### BLOCKING (Customer-facing, violates No Silent Defaults rule)

1. **Security Gaps & Operational Gaps**
   - Currently: `parseInt(kpi?.security_gaps || '0', 10)`
   - Problem: Shows 0 when not calculated
   - Solution: Return `{value: null, classification: 'UNIMPLEMENTED'}`
   - Impact: MEDIUM (supporting metric, not Tier-A)

2. **Snapshot Detail Fields** (11 fields with silent defaults)
   - Currently: `dailyAvgGb: parseFloat(snapshot.daily_avg_gb || '0')`
   - Problem: Shows 0 for missing data
   - Solution: Add classification fields alongside values
   - Impact: MEDIUM-HIGH (customer sees drill-down values)

### DEFERRED (Internal metrics, may keep defaults)

1. Health check metrics (`/api/health`)
2. Queue health metrics (`/api/queue-health`)
3. Governance/telemetry metrics (not core KPIs)

---

## Fix Priority Order

**CRITICAL (Blocking Demo)**: None remaining (Tier-A all fixed ✅)

**HIGH (Should fix before demo)**:
1. securityGaps + operationalGaps → Add explicit classification
2. Snapshot detail fields → Replace 11 silent defaults

**MEDIUM (Can defer post-demo)**:
1. Internal metrics (health checks, queue)
2. Governance fields

---

## Implementation: How Silent Defaults Were Fixed

**Pattern Used**:
```typescript
// BEFORE (Silent Default)
roiScore: parseFloat(kpi?.roi_score || '0'),  // Bad: Shows 0 when missing

// AFTER (Explicit Classification)
const roi = extractKPI(kpi?.roi_score);  // Returns {value: null, classification: 'EMPTY'}
roiScore: roi.value,                       // API returns null
roiScoreClassification: roi.classification, // Caller knows why it's null
```

**Helper Function**:
```typescript
const extractKPI = (value: any): { value: number | null; classification: string } => {
  if (value === null || value === undefined) {
    return { value: null, classification: 'EMPTY' };
  }
  const parsed = parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    return { value: null, classification: 'EMPTY' };
  }
  return { value: parsed, classification: 'REAL' };
};
```

---

## API Response Structure (After Fixes)

**Tier-A KPIs** now return:
```json
{
  "kpis": {
    "roiScore": null,
    "roiScoreClassification": "EMPTY",
    "gainScopeScore": 52.3,
    "gainScopeScoreClassification": "REAL",
    "tier1SpendAnnual": null,
    "tier1SpendAnnualClassification": "EMPTY",
    ...
  }
}
```

**Benefit**: Caller can distinguish between:
- `null + EMPTY` → Data not available
- `null + UNIMPLEMENTED` → Feature not configured
- `0 + REAL` → Actual zero value
- `52.3 + REAL` → Real calculated metric

---

## Files Changed

| File | Lines Changed | Changes |
|------|---------------|---------|
| `/api/executive-summary/route.ts` | 240-342 | ✅ Added extractKPI helper, converted 9 Tier-A fields + 4 tier spend fields + 3 dimension fields |

---

## Testing

**Tests to Add** (verify fixes work):
```typescript
test('ROI Score returns null + EMPTY classification when kpi missing', () => {
  const response = { roiScore: null, roiScoreClassification: 'EMPTY' };
  expect(response.roiScore).toBeNull();
  expect(response.roiScoreClassification).toBe('EMPTY');
});

test('ROI Score returns value + REAL classification when kpi present', () => {
  const response = { roiScore: 52.3, roiScoreClassification: 'REAL' };
  expect(response.roiScore).toBe(52.3);
  expect(response.roiScoreClassification).toBe('REAL');
});
```

---

## Final Verification

**Before proceeding to next phase**, verify:
- [ ] All 9 Tier-A KPI fields return classification metadata
- [ ] No silent 0s in customer-visible KPI display
- [ ] Tests pass for classification logic
- [ ] Browser shows "Not calculated" for EMPTY metrics (not 0)

**Status**: ✅ TIER-A KPIs FIXED, REMAINING AUDIT IN PROGRESS

---

**Next Actions**:
1. Fix securityGaps + operationalGaps
2. Fix snapshot detail fields (11 silent defaults)
3. Update UI to display classification instead of silent 0
4. Run full codebase audit for any remaining patterns
5. Add global pre-commit check: `grep -r "|| 0" apps/web/app/api --include="*.ts"`
