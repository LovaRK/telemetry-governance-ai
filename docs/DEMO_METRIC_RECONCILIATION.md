# Demo Metric Reconciliation Template

**Purpose**: Verify that every metric shown in the demo matches between Database → API → UI.

**Timeline**: Run this verification on a fresh refresh, capture all three layers, and confirm alignment.

---

## P1: Database Values

**Query to run:**
```sql
SELECT
  snapshot_date,
  roi_score,
  gainscope_score,
  total_license_spend,
  license_spend_low_value,
  storage_savings_potential,
  total_daily_gb,
  tier_critical,
  tier_important,
  tier_nice_to_have,
  tier_low_value,
  avg_confidence,
  avg_utilization,
  avg_detection,
  avg_quality,
  security_gaps,
  operational_gaps,
  created_at
FROM executive_kpis
WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM executive_kpis)
LIMIT 1;
```

**Capture into this table:**

| Metric | DB Value | Notes |
|--------|----------|-------|
| ROI Score | __ | Should be 0-100 |
| GainScope % | __ | Should be 0-100 |
| Total License Spend | __ | USD amount |
| License Spend Low Value | __ | USD amount |
| Storage Savings Potential | __ | USD amount |
| Total Daily GB | __ | GB quantity |
| Tier Critical (count) | __ | Integer |
| Tier Important (count) | __ | Integer |
| Tier Nice-to-Have (count) | __ | Integer |
| Tier Low Value (count) | __ | Integer |
| Avg Confidence | __ | Should be 0-100 |
| Avg Utilization | __ | Should be 0-100 |
| Avg Detection | __ | Should be 0-100 |
| Avg Quality | __ | Should be 0-100 |
| Security Gaps | __ | **EXPECTED: NULL or 0** |
| Operational Gaps | __ | **EXPECTED: NULL or 0** |
| Created At | __ | Timestamp |

---

## P2: API Response Values

**Endpoint**: `GET /api/executive-summary`

**Command**:
```bash
curl http://localhost:3000/api/executive-summary \
  -H "x-tenant-id: default" \
  -H "x-user-id: test-user" \
  -H "x-user-role: admin" \
  -H "Authorization: Bearer test-token" | jq '.'
```

**Capture into this table:**

| Metric | API Value | Notes |
|--------|-----------|-------|
| roiScore | __ | Should match DB |
| gainScopeScore | __ | Should match DB |
| totalLicenseSpend | __ | Should match DB |
| licenseSpendLowValue | __ | Should match DB |
| storageSavingsPotential | __ | Should match DB |
| totalDailyGb | __ | Should match DB |
| tierCounts.critical | __ | Should match DB |
| tierCounts.important | __ | Should match DB |
| tierCounts.niceToHave | __ | Should match DB |
| tierCounts.lowValue | __ | Should match DB |
| avgConfidence | __ | Should be 0-100, not 0-1 |
| avgUtilization | __ | Should match DB |
| avgDetection | __ | Should match DB |
| avgQuality | __ | Should match DB |
| securityGaps | __ | **EXPECTED: 0 or omitted** |
| operationalGaps | __ | **EXPECTED: 0 or omitted** |

---

## P3: UI Display Values

**Navigate to**: http://localhost:3000

**Capture into this table:**

| Metric | UI Value | Match DB? | Match API? | Notes |
|--------|----------|-----------|-----------|-------|
| ROI Score | __ | ✓/✗ | ✓/✗ | Card display |
| GainScope % | __ | ✓/✗ | ✓/✗ | Card display |
| Annual Spend | __ | ✓/✗ | ✓/✗ | Header display |
| Savings Potential | __ | ✓/✗ | ✓/✗ | Header display |
| Tier Critical | __ | ✓/✗ | ✓/✗ | Bar chart |
| Tier Important | __ | ✓/✗ | ✓/✗ | Bar chart |
| Tier Nice-to-Have | __ | ✓/✗ | ✓/✗ | Bar chart |
| Tier Low Value | __ | ✓/✗ | ✓/✗ | Bar chart |
| Avg Confidence | __ | ✓/✗ | ✓/✗ | Card display |
| Sec. Gaps | __ | N/A | N/A | Should show [Not Calculated] |
| Ops Gaps | __ | N/A | N/A | Should show [Not Calculated] |

---

## P4: Metric Classification

For every metric shown in the demo, classify it as:

| Metric | Classification | Status | Why |
|--------|----------------|--------|-----|
| ROI Score | **REAL** | ✅ Demo Ready | Calculated deterministically from database |
| GainScope % | **REAL** | ✅ Demo Ready | Calculated deterministically from database |
| License Spend | **REAL** | ✅ Demo Ready | Direct fact from database |
| Tier Spend (×4) | **REAL** | ✅ Demo Ready | Count from scored_results table |
| Storage Savings | **REAL** | ✅ Demo Ready | Calculated from tier assignment |
| Avg Confidence | **REAL** | ✅ Demo Ready | Average from decision scores |
| Avg Utilization | **REAL** | ✅ Demo Ready | Calculated from weighted sum |
| Avg Detection | **REAL** | ✅ Demo Ready | Calculated from MITRE potential + realized |
| Avg Quality | **REAL** | ✅ Demo Ready | Calculated from parsing issues |
| Security Gaps | **UNIMPLEMENTED** | ⏸️ Hidden | Not calculated by LLM; defaults to 0 |
| Operational Gaps | **UNIMPLEMENTED** | ⏸️ Hidden | Not calculated by LLM; defaults to 0 |
| MITRE Coverage | **BASELINE** | ✅ Demo Ready | Reference model for Phase 2 integration |
| Lantern Coverage | **BASELINE** | ✅ Demo Ready | Reference model for Phase 2 integration |

---

## Demo Configuration

**SHOW** (verified as REAL):
- ROI Score
- GainScope %
- License Spend
- Tier Spend (all 4 tiers)
- Storage Savings Potential
- Daily Ingest (GB)
- Average Confidence
- Average Utilization
- Average Detection
- Average Quality
- Provenance badges on all metrics
- Formula transparency (ⓘ buttons)

**SHOW with BASELINE badge** (reference values for Phase 2):
- MITRE Coverage
- Lantern Coverage

**HIDE** (unimplemented):
- Security Gaps → Shows "Not Calculated"
- Operational Gaps → Shows "Not Calculated"
- Decision Review Queue → Not shown
- Queue Health → Renamed to "Pipeline Telemetry"

---

## Pass Criteria

✅ **All metrics shown match across DB → API → UI**
✅ **Confidence values are 0-100, not 10000%**
✅ **Unimplemented metrics show honest status (not fake zeros)**
✅ **Every metric has a clear REAL/BASELINE/UNIMPLEMENTED classification**
✅ **Formula transparency works (ⓘ modals display correctly)**
✅ **Provenance badges display source/timestamp/classification**
✅ **Browser console clean (no errors)**

---

## Red Flags (Fail Criteria)

❌ **Any metric shows different value in DB vs API vs UI**
❌ **Confidence shows values > 100%**
❌ **Security Gaps or Operational Gaps show as numbers instead of "Not Calculated"**
❌ **Decision Review Queue is visible**
❌ **Formula modals show "undefined" or blank**
❌ **Browser console has errors**

---

## What to Do With Results

### If ALL pass criteria:
✅ **DEMO READY**
- Dashboard is trustworthy
- Metrics are verifiable
- No fake data shown

### If ANY fail criteria:
❌ **DO NOT DEMO**
- Identify which metric failed
- Fix the underlying issue (not cosmetics)
- Re-run verification
- Only proceed once all pass

---

**Date Verified**: _______________  
**DB Snapshot Time**: _______________  
**Verified By**: _______________
