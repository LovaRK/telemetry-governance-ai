# DB → API → UI Certification Execution Plan

**Date**: 2026-06-03  
**Status**: ✅ FRAMEWORK READY FOR EXECUTION  
**Purpose**: Verify all Tier-A KPI values match exactly across Database → API → UI layers

---

## Certification Gate (5-Point, Per KPI)

For each metric, verify ALL 5 gates pass before demo:

1. **Formula Verified** ✅ (Already complete)
2. **DB Verified** ⏳ (Execute now)
3. **API Verified** ⏳ (Execute now)
4. **UI Verified** ⏳ (Execute now)
5. **Provenance Verified** ⏳ (Execute now)

**DEMO IS BLOCKED unless all 6 Tier-A KPIs pass all 5 gates.**

---

## Tier-A KPIs to Certify (6 Metrics)

1. ROI Score
2. GainScope %
3. Storage Savings Potential
4. Total License Spend
5. Tier Spend (Tier 1/2/3/4)
6. Average Confidence

---

## Execution Workflow (Copy-Paste Ready)

### PHASE 1: Database Values

**Step 1.1: Connect to Database**
```bash
# Set up your database connection
export DATABASE_URL="your_connection_string"

# Or if using psql:
psql -h localhost -U user -d database_name
```

**Step 1.2: Query Each Metric**

```sql
-- Get all Tier-A metrics in one query
SELECT 
  roi_score,
  gainscope_score,
  storage_savings_potential,
  total_license_spend,
  tier_1_spend_annual,
  tier_2_spend_annual,
  tier_3_spend_annual,
  tier_4_spend_annual,
  avg_confidence
FROM executive_kpis
WHERE tenant_id = 'YOUR_TENANT_ID'
  AND snapshot_id = 'YOUR_SNAPSHOT_ID'
LIMIT 1;
```

**Step 1.3: Document Results**

Create file: `docs/CERTIFICATION_DB_VALUES.txt`

```
Database Values (2026-06-03):
─────────────────────────────────────────
ROI Score:              [VALUE FROM DB]
GainScope %:            [VALUE FROM DB]
Storage Savings:        [VALUE FROM DB]
Total License Spend:    [VALUE FROM DB]
Tier 1 Annual:          [VALUE FROM DB]
Tier 2 Annual:          [VALUE FROM DB]
Tier 3 Annual:          [VALUE FROM DB]
Tier 4 Annual:          [VALUE FROM DB]
Avg Confidence:         [VALUE FROM DB]
```

---

### PHASE 2: API Values

**Step 2.1: Get API Token** (if using auth)
```bash
# Obtain valid bearer token for your environment
export TOKEN="your_auth_token"
```

**Step 2.2: Call API Endpoint**
```bash
# Production endpoint
curl -X GET \
  "http://localhost:3000/api/executive-summary?tenant_id=YOUR_TENANT_ID&snapshot_id=YOUR_SNAPSHOT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  | jq '.data.kpis' > /tmp/api_response.json

# View formatted
cat /tmp/api_response.json | jq '.'
```

**Step 2.3: Extract Metrics**
```bash
# Extract just the Tier-A metrics
cat /tmp/api_response.json | jq '{
  roiScore: .roiScore,
  roiScoreClassification: .roiScoreClassification,
  gainScopeScore: .gainScopeScore,
  gainScopeScoreClassification: .gainScopeScoreClassification,
  storageSavingsPotential: .storageSavingsPotential,
  storageSavingsPotentialClassification: .storageSavingsPotentialClassification,
  totalLicenseSpend: .totalLicenseSpend,
  totalLicenseSpendClassification: .totalLicenseSpendClassification,
  tier1SpendAnnual: .tier1SpendAnnual,
  tier1SpendAnnualClassification: .tier1SpendAnnualClassification,
  tier2SpendAnnual: .tier2SpendAnnual,
  tier2SpendAnnualClassification: .tier2SpendAnnualClassification,
  tier3SpendAnnual: .tier3SpendAnnual,
  tier3SpendAnnualClassification: .tier3SpendAnnualClassification,
  tier4SpendAnnual: .tier4SpendAnnual,
  tier4SpendAnnualClassification: .tier4SpendAnnualClassification,
  avgConfidence: .avgConfidence,
  avgConfidenceClassification: .avgConfidenceClassification
}'
```

**Step 2.4: Document Results**

Create file: `docs/CERTIFICATION_API_VALUES.txt`

```
API Values (2026-06-03):
─────────────────────────────────────────
roiScore:               [VALUE FROM API]
roiScoreClassification: [CLASSIFICATION]
gainScopeScore:         [VALUE FROM API]
gainScopeScoreClassification: [CLASSIFICATION]
... (continue for all fields)
```

---

### PHASE 3: UI Values

**Step 3.1: Open Dashboard**
1. Open browser: `http://localhost:3000/dashboard`
2. Login as customer/demo user
3. Navigate to: **Executive Overview** tab
4. Ensure data is loaded (no spinners)

**Step 3.2: Verify Tier-A KPIs Visible**
- [ ] ROI Score card visible
- [ ] GainScope % card visible
- [ ] Storage Savings card visible
- [ ] Total License Spend card visible
- [ ] Tier Spend cards (4) visible
- [ ] Average Confidence badge visible

**Step 3.3: Take Screenshots**

For each KPI, take a screenshot showing:
1. The metric card/value
2. The provenance badge below it (source, timestamp, confidence)
3. Click "ⓘ" to show formula breakdown (if implemented)

```
Screenshots to take:
├── roi_score_card.png
├── roi_score_formula_modal.png
├── gainscope_card.png
├── gainscope_formula_modal.png
├── storage_savings_card.png
├── storage_savings_formula_modal.png
├── license_spend_card.png
├── license_spend_formula_modal.png
├── tier_1_card.png
├── tier_2_card.png
├── tier_3_card.png
├── tier_4_card.png
└── avg_confidence_card.png
```

**Step 3.4: Document Results**

Create file: `docs/CERTIFICATION_UI_VALUES.txt`

```
UI Values (2026-06-03):
─────────────────────────────────────────
ROI Score (displayed):          [VALUE SEEN ON SCREEN]
GainScope % (displayed):        [VALUE SEEN ON SCREEN]
Storage Savings (displayed):    [VALUE SEEN ON SCREEN]
Total License Spend (displayed): [VALUE SEEN ON SCREEN]
Tier 1 Annual (displayed):      [VALUE SEEN ON SCREEN]
Tier 2 Annual (displayed):      [VALUE SEEN ON SCREEN]
Tier 3 Annual (displayed):      [VALUE SEEN ON SCREEN]
Tier 4 Annual (displayed):      [VALUE SEEN ON SCREEN]
Avg Confidence (displayed):     [VALUE SEEN ON SCREEN]
```

---

### PHASE 4: Provenance Verification

**Step 4.1: Check Provenance on Each Metric**

For each Tier-A KPI card:
1. Hover over or click the "ℹ" icon
2. Verify tooltip/badge shows:
   - Source table name (e.g., "scored_results")
   - Pipeline run ID (e.g., "run_20260603_001")
   - Generated timestamp (e.g., "2 min ago")
   - Confidence percentage (e.g., "94%")

**Step 4.2: Document Provenance**

Create file: `docs/CERTIFICATION_PROVENANCE.txt`

```
Provenance Verification (2026-06-03):
─────────────────────────────────────────

ROI Score:
  Source: [TABLE NAME]
  Pipeline Run: [RUN ID]
  Generated: [TIMESTAMP]
  Confidence: [%]
  ✓ ALL VISIBLE

GainScope:
  Source: [TABLE NAME]
  ... (repeat for all 6 metrics)
```

---

## Certification Matching Matrix

After executing all 4 phases, fill in this table:

### ROI Score
```
┌─────────────────┬──────────┬──────────┬──────────┐
│                 │ Expected │ Actual   │ Match?   │
├─────────────────┼──────────┼──────────┼──────────┤
│ DB Value        │ [DB VAL] │ [DB VAL] │    ✓     │
│ API Value       │ [DB VAL] │ [API VAL]│ ✓ or ✗   │
│ UI Display      │ [API VAL]│ [UI VAL] │ ✓ or ✗   │
│ Provenance      │ visible  │ visible  │ ✓ or ✗   │
├─────────────────┼──────────┼──────────┼──────────┤
│ **Result**      │          │          │**GO/NO-GO**│
└─────────────────┴──────────┴──────────┴──────────┘
```

**Repeat this for all 6 Tier-A KPIs.**

---

## Go/No-Go Decision Matrix

| KPI | Formula ✓ | DB ✓ | API ✓ | UI ✓ | Provenance ✓ | Status |
|-----|----------|------|-------|------|--------------|--------|
| ROI | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| GainScope | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| Storage Savings | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| Total Spend | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| Tier 1 | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| Tier 2 | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| Tier 3 | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| Tier 4 | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |
| Avg Confidence | ✓ | ⏳ | ⏳ | ⏳ | ⏳ | PENDING |

---

## Failure Troubleshooting

**If DB ≠ API:**
1. Check API endpoint source code (which table queried?)
2. Verify API is reading from correct table
3. Check for silent defaults (`|| 0` patterns)
4. Run API manually with same parameters

**If API ≠ UI:**
1. Check browser console (F12) for errors
2. Verify API response field names match component expectations
3. Check component is reading correct API field
4. Compare component actual value vs expected value

**If Provenance Missing:**
1. Check API response includes metadata fields
2. Verify component receives metadata
3. Ensure component is rendering provenance badge
4. Check CSS/styling isn't hiding the badge

---

## Expected Values (Reference)

From test data, expect approximately:
```
ROI Score:           52.3
GainScope %:         67.0%
Storage Savings:     $187,000
Total Spend:         $847,000
Tier 1:              $425,000 (23 critical)
Tier 2:              $235,000 (18 important)
Tier 3:              $142,000 (12 nice-to-have)
Tier 4:              $45,000  (5 low-value)
Avg Confidence:      94%
```

**Note**: Your environment may have different values. The test is: **DB = API = UI for whatever values you have**.

---

## Final Certification Report

**Template**: Create `docs/CERTIFICATION_FINAL_REPORT.md`

```markdown
# Final Certification Report — 2026-06-03

## Executive Summary

✅ All 6 Tier-A KPIs verified across all 5 gates
✅ Database values match API values exactly
✅ API values match UI values exactly
✅ Provenance visible on all metrics
✅ DEMO IS GO

## Details

[Include matching matrix and screenshots]

## Blockers

[List any GO/NO-GO blockers]

## Signed Off By

- Date: 2026-06-03
- Verified By: [Your Name]
```

---

## Command Summary (All-In-One)

After setup, run this to execute all phases:

```bash
# Phase 1: Get DB values
psql $DATABASE_URL -c "SELECT roi_score, gainscope_score, ... FROM executive_kpis WHERE tenant_id='X' LIMIT 1;" > db_values.txt

# Phase 2: Get API values
curl "http://localhost:3000/api/executive-summary?tenant_id=X" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.kpis' > api_values.json

# Phase 3: Manual (open browser, take screenshots)
# Phase 4: Manual (check provenance badges)

# Compare
echo "=== DB vs API ==="
diff <(jq -r '.[]' db_values.txt | sort) <(jq -r '.roiScore, .gainScopeScore, ...' api_values.json | sort)
```

---

## Timeline

**Execution time**: ~30-45 minutes (4 phases)
- Phase 1 (DB): 5 min
- Phase 2 (API): 10 min
- Phase 3 (UI): 20 min
- Phase 4 (Provenance): 10 min

**Documentation time**: 15 min

**Total**: 45-60 minutes

---

## Next Steps After Certification

1. ✅ All 6 KPIs pass all 5 gates → **PROCEED TO DEMO**
2. ❌ Any KPI fails any gate → **FIX BLOCKER + RETEST**
3. ⏳ Provenance not visible → **DEBUG UI RENDERING**
4. ⏳ Snapshot details wrong → **AUDIT SCOPE (may be out of scope for Tier-A)**

---

**Status**: Ready for execution. Follow phases 1-4 above in order.

**Expected Result**: All 6 Tier-A KPIs certified ✅ → Demo Freeze Approved ✅
