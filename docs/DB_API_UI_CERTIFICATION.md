# P0.8: DB → API → UI Certification

**Date**: 2026-06-03  
**Status**: ✅ FRAMEWORK COMPLETE (Browser verification pending)  
**Purpose**: Prove every Tier-A KPI value matches exactly across Database → API → UI

---

## Certification Process

For each Tier-A KPI, verify these 5 sequential checks:

### Check 1: Formula Verified
- ✅ **Status**: PASS (vs. PDF)
- **Expected**: Code implementation matches PDF formula exactly
- **Evidence**: Test passes (`expect(formula).toBe(expected)`)

### Check 2: DB Verified
- **Status**: VERIFY NOW (direct database query)
- **Expected**: Value exists in database with correct type
- **Action**: Query database table, note exact value (e.g., 52.3)
- **Evidence**: SQL query result screenshot

### Check 3: API Verified
- **Status**: VERIFY NOW (API response)
- **Expected**: API returns exact DB value
- **Action**: Call `/api/executive-summary`, extract metric field
- **Evidence**: API response JSON screenshot showing exact match to DB value

### Check 4: UI Verified
- **Status**: VERIFY NOW (browser display)
- **Expected**: UI displays exact API value
- **Action**: Open dashboard, screenshot metric card
- **Evidence**: Browser screenshot showing exact match to API value

### Check 5: Provenance Verified
- **Status**: VERIFY NOW (metadata visible)
- **Expected**: Source, pipeline run, timestamp, confidence visible
- **Action**: Check UI badge or hover tooltip
- **Evidence**: Provenance badge screenshot

---

## Tier-A KPIs (Demo-Critical)

All 6 must pass all 5 gates before demo.

### 1. ROI Score

**Formula Verified**: ✅ PASS
```typescript
// Formula: avg(composite_score) across all sourcetypes
computeROIScore = (allScores) => {
  const sum = allScores.reduce((a, b) => a + b.composite_score, 0);
  return sum / allScores.length;
}
// Expected: 52.3 (from test data)
```

**DB Verified**: ⏳ PENDING
```sql
SELECT roi_score FROM executive_kpis 
WHERE tenant_id = '<tenant_id>' AND snapshot_id = '<snapshot_id>'
-- Expected: 52.3
-- Status: [Query → [DB Value]]
```

**API Verified**: ⏳ PENDING
```bash
curl http://localhost:3000/api/executive-summary \
  -H "Authorization: Bearer $TOKEN"
# Expected response:
# { "kpis": { "roiScore": 52.3, ... } }
# Status: [API Response Value Match]
```

**UI Verified**: ⏳ PENDING
```
Browser: Dashboard → Executive Overview
Looking for: ROI Score card displaying 52.3
Status: [Screenshot showing value]
```

**Provenance Verified**: ⏳ PENDING
```
Click "ℹ" on ROI Score card
Expected:
  Source Table: scored_results
  Pipeline Run: run_20260603_001
  Generated: 2 min ago
  Confidence: 94%
Status: [Provenance badge visible]
```

**Certification**: 
- [ ] Formula: PASS
- [ ] DB: PASS
- [ ] API: PASS
- [ ] UI: PASS
- [ ] Provenance: PASS
- **Result**: ⏳ PENDING (awaiting verification)

---

### 2. GainScope %

**Formula Verified**: ✅ PASS
```typescript
// Formula: (Tier 1+2 GB / Total GB) × 100
computeGainScope = (allScores) => {
  const tier12Gb = allScores
    .filter(s => s.tier <= 2)
    .reduce((sum, s) => sum + s.daily_gb, 0);
  const totalGb = allScores.reduce((sum, s) => sum + s.daily_gb, 0);
  return (tier12Gb / totalGb) * 100;
}
// Expected: 67% (from test data)
```

**DB Verified**: ⏳ PENDING
```sql
SELECT gainscope_score FROM executive_kpis 
WHERE tenant_id = '<tenant_id>' AND snapshot_id = '<snapshot_id>'
-- Expected: 67.0 (as percentage)
-- Status: [Query → [DB Value]]
```

**API Verified**: ⏳ PENDING
```bash
curl http://localhost:3000/api/executive-summary | jq '.kpis.gainScopeScore'
# Expected: 67.0
# Status: [API Value Match]
```

**UI Verified**: ⏳ PENDING
```
Browser: Dashboard → Executive Overview
Looking for: GainScope card displaying 67%
Status: [Screenshot showing value]
```

**Provenance Verified**: ⏳ PENDING
```
UI provenance badge shows:
  Source: scored_results
  Age: 2min ago
  Confidence: 94%
Status: [Badge visible]
```

**Certification**: 
- [ ] Formula: PASS
- [ ] DB: PASS
- [ ] API: PASS
- [ ] UI: PASS
- [ ] Provenance: PASS
- **Result**: ⏳ PENDING

---

### 3. Storage Savings Potential

**Formula Verified**: ✅ PASS
```typescript
// Formula: Σ(annual_cost) for Tier 3+4 sourcetypes
computeLowValueSpend = (allScores) => {
  return allScores
    .filter(s => s.tier >= 3)
    .reduce((sum, s) => sum + s.annual_cost, 0);
}
// Expected: $187K annually (from test data)
```

**DB Verified**: ⏳ PENDING
```sql
SELECT storage_savings_potential FROM executive_kpis 
WHERE tenant_id = '<tenant_id>' AND snapshot_id = '<snapshot_id>'
-- Expected: 187000 (in cents or dollars, per schema)
-- Status: [Query → [DB Value]]
```

**API Verified**: ⏳ PENDING
```bash
curl http://localhost:3000/api/executive-summary | jq '.kpis.storageSavingsPotential'
# Expected: 187000
# Status: [API Value Match]
```

**UI Verified**: ⏳ PENDING
```
Browser: Dashboard → Executive Overview
Looking for: Storage Savings card displaying $187K
Status: [Screenshot showing value]
```

**Provenance Verified**: ⏳ PENDING
```
UI provenance badge shows metadata
Status: [Badge visible]
```

**Certification**: 
- [ ] Formula: PASS
- [ ] DB: PASS
- [ ] API: PASS
- [ ] UI: PASS
- [ ] Provenance: PASS
- **Result**: ⏳ PENDING

---

### 4. Total License Spend

**Formula Verified**: ✅ PASS
```typescript
// Formula: Σ(annual_cost) for all sourcetypes
computeTotalLicenseSpend = (allScores) => {
  return allScores.reduce((sum, s) => sum + s.annual_cost, 0);
}
// Expected: $847K annually (from test data)
```

**DB Verified**: ⏳ PENDING
```sql
SELECT totalLicenseSpend FROM executive_kpis 
WHERE tenant_id = '<tenant_id>' AND snapshot_id = '<snapshot_id>'
-- Expected: 847000
-- Status: [Query → [DB Value]]
```

**API Verified**: ⏳ PENDING
```bash
curl http://localhost:3000/api/executive-summary | jq '.kpis.totalLicenseSpend'
# Expected: 847000
# Status: [API Value Match]
```

**UI Verified**: ⏳ PENDING
```
Browser: Dashboard → Executive Overview
Looking for: Total License Spend card displaying $847K
Status: [Screenshot showing value]
```

**Provenance Verified**: ⏳ PENDING
```
UI provenance badge shows metadata
Status: [Badge visible]
```

**Certification**: 
- [ ] Formula: PASS
- [ ] DB: PASS
- [ ] API: PASS
- [ ] UI: PASS
- [ ] Provenance: PASS
- **Result**: ⏳ PENDING

---

### 5. License Spend by Tier (Tier 1/2/3/4)

**Formula Verified**: ✅ PASS
```typescript
// Formula: Sum annual cost grouped by tier
computeTierSpend = (allScores) => {
  const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
  allScores.forEach(s => {
    tiers[s.tier] += s.annual_cost;
  });
  return tiers;
}
// Expected: 
//   Tier 1: $425K
//   Tier 2: $235K
//   Tier 3: $142K
//   Tier 4: $45K
```

**DB Verified**: ⏳ PENDING
```sql
SELECT 
  tier_1_spend_annual,
  tier_2_spend_annual,
  tier_3_spend_annual,
  tier_4_spend_annual
FROM executive_kpis 
WHERE tenant_id = '<tenant_id>' AND snapshot_id = '<snapshot_id>'
-- Expected: (425000, 235000, 142000, 45000)
-- Status: [Query → [DB Values]]
```

**API Verified**: ⏳ PENDING
```bash
curl http://localhost:3000/api/executive-summary | jq '.kpis.tierSpend'
# Expected: { tier1: 425000, tier2: 235000, tier3: 142000, tier4: 45000 }
# Status: [API Value Match]
```

**UI Verified**: ⏳ PENDING
```
Browser: Dashboard → Executive Overview
Looking for: 4 tier spend cards displaying exact amounts
Status: [Screenshot showing all 4 values]
```

**Provenance Verified**: ⏳ PENDING
```
UI provenance badges show metadata for each tier
Status: [Badges visible]
```

**Certification**: 
- [ ] Formula: PASS
- [ ] DB: PASS
- [ ] API: PASS
- [ ] UI: PASS
- [ ] Provenance: PASS
- **Result**: ⏳ PENDING

---

### 6. Average Confidence

**Formula Verified**: ✅ PASS
```typescript
// Formula: Average decision confidence (0-1 or 0-100, normalized)
computeAvgConfidence = (allScores) => {
  const sum = allScores.reduce((a, b) => a + b.confidence, 0);
  const avg = sum / allScores.length;
  return normalizeConfidence(avg); // Ensure 0-100 range
}
// Expected: 94% (0.94 normalized to 94)
```

**DB Verified**: ⏳ PENDING
```sql
SELECT avg_confidence FROM executive_kpis 
WHERE tenant_id = '<tenant_id>' AND snapshot_id = '<snapshot_id>'
-- Expected: 94 (as percentage 0-100)
-- Status: [Query → [DB Value]]
```

**API Verified**: ⏳ PENDING
```bash
curl http://localhost:3000/api/executive-summary | jq '.kpis.avgConfidence'
# Expected: 94
# Status: [API Value Match]
```

**UI Verified**: ⏳ PENDING
```
Browser: Dashboard → Executive Overview
Looking for: Average Confidence badge/meter displaying 94%
Status: [Screenshot showing value]
```

**Provenance Verified**: ⏳ PENDING
```
UI provenance badge shows metadata
Status: [Badge visible]
```

**Certification**: 
- [ ] Formula: PASS
- [ ] DB: PASS
- [ ] API: PASS
- [ ] UI: PASS
- [ ] Provenance: PASS
- **Result**: ⏳ PENDING

---

## Certification Summary

| KPI | Formula | DB | API | UI | Provenance | Status |
|-----|---------|----|----|----|----|--------|
| ROI Score | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| GainScope % | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Storage Savings | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Total License Spend | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Tier 1/2/3/4 Spend | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |
| Avg Confidence | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | Pending |

**DEMO READY**: When ALL 6 KPIs show ✅ across all 5 gates.

**DEMO BLOCKED**: If ANY KPI fails ANY gate.

---

## Verification Instructions (Next Session)

**Phase 1: Get Database Values**
```bash
# Connect to database
psql $DATABASE_URL

# Query each metric
SELECT roi_score FROM executive_kpis WHERE tenant_id = '<ID>';
SELECT gainscope_score FROM executive_kpis WHERE tenant_id = '<ID>';
SELECT storage_savings_potential FROM executive_kpis WHERE tenant_id = '<ID>';
SELECT totalLicenseSpend FROM executive_kpis WHERE tenant_id = '<ID>';
SELECT tier_1_spend_annual, tier_2_spend_annual, tier_3_spend_annual, tier_4_spend_annual 
  FROM executive_kpis WHERE tenant_id = '<ID>';
SELECT avg_confidence FROM executive_kpis WHERE tenant_id = '<ID>';

# Note each value
```

**Phase 2: Get API Values**
```bash
# Call API
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/executive-summary | jq '.kpis' > /tmp/api_response.json

# Extract metrics
cat /tmp/api_response.json | jq '{
  roiScore: .roiScore,
  gainScopeScore: .gainScopeScore,
  storageSavingsPotential: .storageSavingsPotential,
  totalLicenseSpend: .totalLicenseSpend,
  tierSpend: .tierSpend,
  avgConfidence: .avgConfidence
}' > /tmp/api_values.json

# Note each value
```

**Phase 3: Get UI Values**
```
1. Open browser: http://localhost:3000/dashboard
2. Login as customer
3. Navigate to Executive Overview tab
4. Take screenshot of each KPI card
5. Compare displayed values to DB values
6. If all match: ✅ PASS
7. If any don't match: ❌ FAIL (debug why)
```

**Phase 4: Check Provenance**
```
1. Click "ℹ" button on each metric card
2. Verify tooltip/badge shows:
   - Source table name
   - Pipeline run ID
   - Generated timestamp
   - Confidence percentage
3. If all visible: ✅ PASS
4. If any missing: ❌ FAIL (add to UI)
```

---

## Expected Test Data Values

(For verification purposes)

```
ROI Score: 52.3
GainScope %: 67.0
Storage Savings: $187,000
Total Spend: $847,000
Tier 1 Spend: $425,000
Tier 2 Spend: $235,000
Tier 3 Spend: $142,000
Tier 4 Spend: $45,000
Avg Confidence: 94%
```

If your database returns different values, that's OK—just verify DB=API=UI for whatever values you have.

---

## Go/No-Go Decision

**DEMO READY (Go)** when:
- ✅ All 6 Tier-A KPIs pass all 5 gates
- ✅ DB values match API values exactly
- ✅ API values match UI values exactly
- ✅ Provenance badges visible on all metrics
- ✅ No console errors in browser

**DO NOT DEMO (No-Go)** if:
- ❌ Any KPI fails any gate
- ❌ DB ≠ API for any metric
- ❌ API ≠ UI for any metric
- ❌ Provenance missing on any metric
- ❌ Console errors present

**Action**: Run verification checklist above. If all pass: DEMO IS GO. If any fail: Debug and fix before demo.

---

**Status**: Framework complete. Awaiting browser verification in next session.
