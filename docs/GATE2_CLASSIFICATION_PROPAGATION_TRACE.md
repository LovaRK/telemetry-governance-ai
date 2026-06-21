# GATE 2: Classification Propagation Trace
## Proving Backend Classification → Frontend Type → Component Rendering

**Status**: ⚠️ **TYPE MISMATCH FOUND**

---

## Complete Trace Path: ROI Score

### STEP 1: Backend Response (Route)

**File**: `/apps/web/app/api/executive-summary/route.ts`

**Lines 277 & 299-300**:
```typescript
const roi = extractKPI(kpi?.roi_score);  // Line 277
// Returns: { value: number | null, classification: 'EMPTY' | 'REAL' }

// In response (lines 299-300):
roiScore: roi.value,                           // null or number
roiScoreClassification: roi.classification,    // 'EMPTY' or 'REAL'
```

**Actual Response Example**:
```json
{
  "kpis": {
    "roiScore": null,
    "roiScoreClassification": "EMPTY"
  }
}
```

**Status**: ✅ Backend returns both value AND classification

---

### STEP 2: Frontend Type Definition

**File**: `/apps/web/lib/types.ts` Lines 77-92

**CURRENT (WRONG)**:
```typescript
export interface ExecutiveKPIs {
  roiScore: number;                    // ❌ Missing: number | null
  gainScopeScore: number;              // ❌ Missing: number | null
  totalLicenseSpend: number;           // ❌ Missing: number | null
  licenseSpendLowValue: number;        // ❌ Missing: number | null
  storageSavingsPotential: number;     // ❌ Missing: number | null
  // ... missing ALL classification fields
  avgConfidence: number;               // ❌ Missing: number | null
  // ... NO tier1SpendAnnual / tier2SpendAnnual / etc
}
```

**REQUIRED (CORRECT)**:
```typescript
export interface ExecutiveKPIs {
  // Tier-A KPIs with classifications
  roiScore: number | null;
  roiScoreClassification: 'EMPTY' | 'REAL';
  
  gainScopeScore: number | null;
  gainScopeScopeClassification: 'EMPTY' | 'REAL';
  
  storageSavingsPotential: number | null;
  storageSavingsPotentialClassification: 'EMPTY' | 'REAL';
  
  totalLicenseSpend: number | null;
  totalLicenseSpendClassification: 'EMPTY' | 'REAL';
  
  licenseSpendLowValue: number | null;
  licenseSpendLowValueClassification: 'EMPTY' | 'REAL';
  
  // Tier Spend with classifications
  tier1SpendAnnual: number | null;
  tier1SpendAnnualClassification: 'EMPTY' | 'REAL';
  
  tier2SpendAnnual: number | null;
  tier2SpendAnnualClassification: 'EMPTY' | 'REAL';
  
  tier3SpendAnnual: number | null;
  tier3SpendAnnualClassification: 'EMPTY' | 'REAL';
  
  tier4SpendAnnual: number | null;
  tier4SpendAnnualClassification: 'EMPTY' | 'REAL';
  
  // Confidence with classification
  avgConfidence: number | null;
  avgConfidenceClassification: 'EMPTY' | 'REAL';
  
  // Supporting metrics with classifications
  avgUtilization: number | null;
  avgUtilizationClassification: 'EMPTY' | 'REAL';
  
  avgDetection: number | null;
  avgDetectionClassification: 'EMPTY' | 'REAL';
  
  avgQuality: number | null;
  avgQualityClassification: 'EMPTY' | 'REAL';
  
  // Keep existing fields for backwards compatibility
  totalDailyGb: number;
  totalSourcetypes: number;
  tierCounts: TierCounts;
  securityGaps: number;
  operationalGaps: number;
}
```

**Status**: ❌ Types don't match backend response

---

### STEP 3: Frontend Component (ExecutiveOverview)

**File**: `/apps/web/components/dashboard/executive-overview/index.tsx`

**Current Pattern (WRONG)**:
```typescript
// Component receives response but types are incorrect
const { kpis } = response.data;

// Tries to render:
<MetricCard 
  title="ROI Score"
  value={kpis.roiScore}  // ❌ Type is `number` but value is `number | null`
/>

// If roiScore is null, renders as blank or 0
// User doesn't see distinction between missing vs calculated
```

**Required Pattern (CORRECT)**:
```typescript
// Component receives response with classifications
const { kpis } = response.data;

// Renders with classification logic:
<MetricCard 
  title="ROI Score"
  value={kpis.roiScore}
  classification={kpis.roiScoreClassification}
  render={(value, classification) => {
    if (classification === 'EMPTY') {
      return <span className="text-gray-400">No data available</span>;
    }
    return <span className="text-lg font-bold">{value.toFixed(1)}%</span>;
  }}
/>
```

**Status**: ⚠️ Component doesn't use classification yet (would render null as blank)

---

### STEP 4: Visual Output

#### Current (Without Classifications)
```
┌─ Executive Overview ─────────────────┐
│ ROI Score       (blank or 0)         │ ❌ User confused: Is there data?
│ GainScope %     (blank or 0)         │ ❌ Is it calculated or missing?
│ Total Spend     (blank or 0)         │ ❌ No provenance
└──────────────────────────────────────┘
```

#### Expected (With Classifications)
```
┌─ Executive Overview ─────────────────┐
│ ROI Score       52.3 | REAL ✓        │ ✅ Data exists + proven real
│                                      │
│ GainScope %     No data available   │ ✅ Explicit: not calculated
│                 EMPTY               │    (not a zero)
│                                      │
│ Total Spend     $487,200 | REAL ✓   │ ✅ Data exists + proven real
│                                      │
│ Tier 1 Spend    No data available   │ ✅ Explicit: not calculated
│                 EMPTY               │
└──────────────────────────────────────┘
```

**Status**: Not yet implemented in component

---

## Complete ROI Score Trace (All 4 Layers)

| Layer | Current | Expected | Gap |
|-------|---------|----------|-----|
| **1. Backend Response** | ✅ Returns {value: null, classification: 'EMPTY'} | ✅ Correct | ✅ NONE |
| **2. Frontend Type** | ❌ `roiScore: number` | ✅ `roiScore: number \| null` + `roiScoreClassification: 'EMPTY' \| 'REAL'` | ❌ **Type mismatch** |
| **3. Component Render** | ❌ Doesn't use classification | ✅ Should check classification before rendering | ❌ **Not implemented** |
| **4. Visual State** | ❌ Shows blank or 0 | ✅ Shows "No data available" or value | ❌ **Wrong message** |

---

## What Needs to Happen (GATE 2 Completeness)

### FIX 1: Update TypeScript Interface

**File**: `/apps/web/lib/types.ts` (Lines 77-92)

**Action**: Replace ExecutiveKPIs interface with classification fields

**Before**:
```typescript
export interface ExecutiveKPIs {
  roiScore: number;
  gainScopeScore: number;
  // ... (missing classifications)
}
```

**After**:
```typescript
export interface ExecutiveKPIs {
  // Each metric now has value + classification
  roiScore: number | null;
  roiScoreClassification: 'EMPTY' | 'REAL';
  
  gainScopeScore: number | null;
  gainScopeScopeClassification: 'EMPTY' | 'REAL';
  
  // ... (all 10 Tier-A metrics + 3 supporting metrics)
}
```

**Status**: Required before component can type-check

---

### FIX 2: Update Component Rendering

**File**: `/apps/web/components/dashboard/executive-overview/index.tsx`

**Add Classification-Aware Renderer**:
```typescript
const renderMetric = (value: number | null, classification: string) => {
  if (classification === 'EMPTY') {
    return (
      <div className="text-gray-400 text-sm">
        <span>No data available</span>
        <span className="ml-2 text-xs bg-yellow-50 px-2 py-1 rounded">
          EMPTY
        </span>
      </div>
    );
  }
  
  if (classification === 'REAL') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold">{value?.toFixed(1)}</span>
        <span className="text-xs bg-green-50 px-2 py-1 rounded">
          REAL
        </span>
      </div>
    );
  }
  
  // Should never reach here
  return <span>Unknown</span>;
};

// Usage in JSX:
<MetricCard>
  {renderMetric(kpis.roiScore, kpis.roiScoreClassification)}
</MetricCard>
```

**Status**: Required to display classification to user

---

### FIX 3: Update API Consumer (Hook)

**File**: Wherever useFetch or useQuery calls /api/executive-summary

**Before**:
```typescript
const { data } = useFetch('/api/executive-summary');
// data.kpis.roiScore is number
// No classification field
```

**After**:
```typescript
const { data } = useFetch<ExecutiveSummary>('/api/executive-summary');
// data.kpis.roiScore is number | null ✓
// data.kpis.roiScoreClassification is 'EMPTY' | 'REAL' ✓
// Type-checked by TypeScript
```

**Status**: Will be fixed automatically when ExecutiveKPIs interface is updated

---

## Complete Classification Fields to Add

### Tier-A KPIs (10 metrics = 20 fields)

```typescript
// 1. ROI Score
roiScore: number | null;
roiScoreClassification: 'EMPTY' | 'REAL';

// 2. GainScope %
gainScopeScore: number | null;
gainScopeScopeClassification: 'EMPTY' | 'REAL';

// 3. Storage Savings Potential
storageSavingsPotential: number | null;
storageSavingsPotentialClassification: 'EMPTY' | 'REAL';

// 4. Total License Spend
totalLicenseSpend: number | null;
totalLicenseSpendClassification: 'EMPTY' | 'REAL';

// 5. License Spend Low Value
licenseSpendLowValue: number | null;
licenseSpendLowValueClassification: 'EMPTY' | 'REAL';

// 6-9. Tier Spend (4 metrics)
tier1SpendAnnual: number | null;
tier1SpendAnnualClassification: 'EMPTY' | 'REAL';

tier2SpendAnnual: number | null;
tier2SpendAnnualClassification: 'EMPTY' | 'REAL';

tier3SpendAnnual: number | null;
tier3SpendAnnualClassification: 'EMPTY' | 'REAL';

tier4SpendAnnual: number | null;
tier4SpendAnnualClassification: 'EMPTY' | 'REAL';

// 10. Average Confidence
avgConfidence: number | null;
avgConfidenceClassification: 'EMPTY' | 'REAL';
```

### Supporting Metrics (3 metrics = 6 fields)

```typescript
// Utilization
avgUtilization: number | null;
avgUtilizationClassification: 'EMPTY' | 'REAL';

// Detection
avgDetection: number | null;
avgDetectionClassification: 'EMPTY' | 'REAL';

// Quality
avgQuality: number | null;
avgQualityClassification: 'EMPTY' | 'REAL';
```

**Total Fields to Add**: 26 new fields

---

## Expected Result After GATE 2 Completion

### 1. Types Match
- ✅ Backend returns `{value, classification}`
- ✅ Frontend types accept `{value, classification}`
- ✅ No TypeScript errors on API response

### 2. Component Receives Classification
- ✅ MetricCard receives value AND classification
- ✅ Can distinguish EMPTY from 0
- ✅ Can show different UI for each state

### 3. User Sees Correct Output
- ✅ Real data shows as numbers + "REAL" badge
- ✅ Missing data shows as "No data available" + "EMPTY" badge
- ✅ No ambiguous blank cards
- ✅ No confusing 0 values for missing data

### 4. No Silent Defaults
- ✅ Null never renders as 0
- ✅ Classification is explicit
- ✅ User knows what they're looking at

---

## Verification Checklist (After Fixes)

- [ ] ExecutiveKPIs interface updated with all 26 classification fields
- [ ] TypeScript typecheck passes (npm run typecheck)
- [ ] MetricCard component uses classification in render logic
- [ ] Component shows "No data available" when classification='EMPTY'
- [ ] Component shows value + badge when classification='REAL'
- [ ] Browser shows correct output for each classification
- [ ] No TypeScript errors in components
- [ ] No runtime errors in console

---

## Current Gap Summary

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Backend Code** | ✅ COMPLETE | executive-summary returns classifications |
| **Backend Compilation** | ✅ COMPLETE | TypeScript typecheck passes |
| **Frontend Type Definition** | ❌ MISSING | ExecutiveKPIs doesn't have classification fields |
| **Component Implementation** | ❌ MISSING | MetricCard doesn't use classifications |
| **Runtime Verification** | ❌ NOT TESTED | Never seen classifications rendered |

---

## Go/No-Go for Gate 2

**Status**: ❌ **NOT READY**

**Blocking Issues**:
1. ❌ Frontend types don't match backend response
2. ❌ Component doesn't render classifications
3. ❌ User will see wrong output (no "No data available" message)

**Required Before Gate 2 Passes**:
1. Update ExecutiveKPIs type with all 26 classification fields
2. Verify TypeScript typecheck still passes
3. Update MetricCard to use classifications
4. Verify browser shows correct output

---

**Assessment**: Gate 2 is 25% complete (backend done, frontend pending)

