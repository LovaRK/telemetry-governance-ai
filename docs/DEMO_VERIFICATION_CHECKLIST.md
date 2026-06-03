# Pre-Demo Verification Checklist (2026-06-04)

**Time**: 45 minutes total  
**Owner**: You (user must perform these checks)  
**Outcome**: Demo-ready or blockers identified  

---

## ✅ Check 1: Formula Modal Click-Through (10 min)

**Objective**: Verify ⓘ icons actually open modals

### Setup
```bash
npm run dev
# Wait for server to start
# Open http://localhost:3000 in browser
```

### Test Sequence

1. **ROI Score**
   - Locate ROI Score card (top row, first gauge)
   - Look for ⓘ icon next to "ROI Score" title
   - Click ⓘ
   - Expected: Modal opens with "ROI Score" heading
   - Pass: ✅ Modal opens  
   - Fail: ❌ Modal doesn't open OR error in console

2. **GainScope %**
   - Locate GainScope card (top row, second gauge)
   - Click ⓘ
   - Expected: Modal opens with "GainScope %" heading
   - Pass: ✅ Modal opens  
   - Fail: ❌ Modal doesn't open OR error

3. **Savings Potential**
   - Locate Savings Potential card (middle row)
   - Click ⓘ
   - Expected: Modal opens with "Storage Savings Potential" heading
   - Pass: ✅ Modal opens  
   - Fail: ❌ Modal doesn't open OR error

4. **Low-Value Spend**
   - Locate Low-Value Spend card (middle row)
   - Click ⓘ
   - Expected: Modal opens with "Low-Value Annual Spend" heading
   - Pass: ✅ Modal opens  
   - Fail: ❌ Modal doesn't open OR error

**Result**:
- [ ] All 4 modals open = **PASS** ✅
- [ ] Any modal fails = **BLOCK** ❌ (see console error below)

---

## ✅ Check 2: Browser Console Clean (5 min)

**Objective**: No React errors, hydration issues, or TypeErrors

### Setup
1. Keep browser open from Check 1
2. Open Developer Tools: **F12**
3. Go to **Console** tab
4. Look at the **red X icon** (errors count) next to "Console"

### Pass Criteria
- [ ] Error count = 0 (no red X visible)
- [ ] Warning count OK (yellow ⚠️ is acceptable)
- [ ] No messages like:
  - "Cannot read property"
  - "is not a function"
  - "Hydration mismatch"
  - "Modal crash"
  - "undefined"

### If Errors Found
Take a screenshot of the red error and report the exact message.

**Result**:
- [ ] Console clean = **PASS** ✅
- [ ] Any red errors = **BLOCK** ❌ (report error message)

---

## ✅ Check 3: Provenance Badge Visibility (10 min)

**Objective**: Source, timestamp, classification visible on metrics

### Test on 3 Metrics

**Metric 1: ROI Score**
- Scroll down to see the ROI Score card
- Below the gauge, look for a small badge
- It should show:
  - Green dot (REAL classification)
  - Text: "Data-backed • executive_kpis"
  - Hover over it → tooltip shows timestamp
- Pass: ✅ Badge visible  
- Fail: ❌ Badge missing

**Metric 2: Tier 1 Spend (Critical)**
- Scroll to "Annual License Spend by Tier" section
- Below the "Critical" bar, look for a badge
- Should show: green dot + "Data-backed • executive_kpis"
- Pass: ✅ Badge visible  
- Fail: ❌ Badge missing

**Metric 3: Security Gaps**
- Scroll to "Coverage Gaps" section
- Below the "Security" gauge, look for a badge
- Should show: green dot + "Data-backed • executive_kpis"
- Pass: ✅ Badge visible  
- Fail: ❌ Badge missing

**Result**:
- [ ] All 3 badges visible = **PASS** ✅
- [ ] Any badge missing = **BLOCK** ❌

---

## ✅ Check 4: One Metric End-to-End (10 min)

**Objective**: Verify data flows correctly: DB → API → Card → Modal

### Test Case: Tier 4 (Low-Value) Spend

**Step 1: Database Value**
```bash
# In a new terminal, connect to Splunk database
# Run this query (or check last known value)
SELECT SUM(annual_license_cost) FROM scored_results WHERE tier = 'Low-Value';
# Expected: 0.37 (or close to it)
# Record: DB_VALUE = [your result]
```

**Step 2: API Value**
```bash
curl -s http://localhost:3000/api/executive-summary \
  -H "x-tenant-id: default" \
  -H "x-user-id: test-user" \
  -H "x-user-role: admin" \
  -H "Authorization: Bearer test-token" | jq '.kpis.licenseSpendLowValue'
# Expected: 0.37
# Record: API_VALUE = [your result]
```

**Step 3: Card Display**
- Look at "Annual License Spend by Tier" section
- Find "Low Value" row (last one)
- Note the dollar amount shown
- Record: CARD_VALUE = [amount shown]

**Step 4: Modal Display**
- Click ⓘ on Tier 4 row
- Modal opens with "Low-Value Annual Spend" title
- Look at the **Result** section (bottom, large green number)
- Record: MODAL_VALUE = [amount shown]

**Comparison**
```
DB_VALUE:    0.37
API_VALUE:   0.37
CARD_VALUE:  0.37
MODAL_VALUE: 0.37
```

**Result**:
- [ ] All 4 values match = **PASS** ✅
- [ ] Any mismatch = **BLOCK** ❌ (report which values differ)

---

## ✅ Check 5: MITRE/Lantern Answer (5 min)

**Objective**: Prepare transparent answer for customer question

### If Customer Asks: "Where does MITRE coverage come from?"

**DO say**:
> "This demo currently uses baseline reference values for MITRE ATT&CK technique coverage. We've designed the system to support live MITRE ATT&CK API integration in production, which will replace these baseline values with real threat framework data."

**DO NOT say**:
> "Real MITRE coverage" (misleading)  
> "We get it from the real MITRE API" (false)  
> "It's all real data" (not accurate for baselines)

### If Customer Asks: "Will this change in production?"
**Answer**:
> "Yes. The architecture is ready. We'll integrate the live MITRE API in Phase 2. For this demo, we're using reference values to show the overall system architecture."

### Test Your Answer
- [ ] Prepared and practiced
- [ ] Uses word "baseline" clearly
- [ ] Explains Phase 2 path
- [ ] Honest about demo limitations

**Result**:
- [ ] Answer prepared = **PASS** ✅
- [ ] Not prepared = **PREP** ⚠️ (write it down now)

---

## Summary Table

| Check | Result | Status | Notes |
|-------|--------|--------|-------|
| 1: Modal click-through | ✅ / ❌ | | ROI, GainScope, Savings, Low Value |
| 2: Browser console | ✅ / ❌ | | 0 red errors |
| 3: Provenance badges | ✅ / ❌ | | 3+ metrics with source/timestamp |
| 4: End-to-end flow | ✅ / ❌ | | Tier 4: DB=API=Card=Modal |
| 5: MITRE/Lantern answer | ✅ / ⚠️ | | Prepared and practiced |

---

## Pass/Fail Decision

### ALL CHECKS PASS ✅
→ **BUILD IS DEMO-READY**
- [ ] Tag the build: `git tag -a demo-2026-06-04 -m "Pre-demo verification passed"`
- [ ] Freeze code: No more commits before demo
- [ ] Do 15-min rehearsal
- [ ] Demo ready

### ANY CHECK FAILS ❌
→ **IDENTIFY BLOCKER**
- Report which check failed
- Report exact error
- Determine if fixable in <30 min
- If fixable: Fix + re-run Check 2 (console clean)
- If not fixable: Adjust demo scope or reschedule

---

## Demo Rehearsal (15 min after verification passes)

1. **Load dashboard** (30 sec)
   - Browser showing Executive Overview tab
   - All KPI cards visible

2. **Show ROI transparency** (3 min)
   - Point to ROI Score card
   - "This metric shows average composite score..."
   - Click ⓘ → Modal shows formula breakdown
   - "Here's exactly how it's calculated"
   - Close modal

3. **Show provenance** (2 min)
   - Point to ProvenanceBadge below any metric
   - "Source: executive_kpis, generated 2 minutes ago"
   - "This data is fresh and verified"

4. **Show tier breakdown** (2 min)
   - Point to "Annual License Spend by Tier"
   - "We break down spend by business value"
   - Click Tier 1 ⓘ → Modal shows calculation
   - "Critical tier spending is [amount]"

5. **Handle MITRE question** (2 min)
   - If asked: Use prepared answer from Check 5
   - Show transparency about baseline values
   - Explain Phase 2 path

6. **Q&A** (3 min)
   - Customer can ask any metric question
   - You can click ⓘ to show formula
   - You can show badge to prove freshness

---

## Time Allocation

| Task | Time | Cumulative |
|------|------|------------|
| Check 1 (modals) | 10 min | 10 min |
| Check 2 (console) | 5 min | 15 min |
| Check 3 (badges) | 10 min | 25 min |
| Check 4 (end-to-end) | 10 min | 35 min |
| Check 5 (answer prep) | 5 min | 40 min |
| **Verification subtotal** | | **40 min** |
| Demo rehearsal | 15 min | **55 min** |
| Buffer | 5 min | **60 min** |

---

## Red Flags (Stop and Debug)

If you see ANY of these, stop and investigate:
- ❌ Modal opens but shows "undefined" values
- ❌ ProvenanceBadge doesn't render
- ❌ Browser console has red errors
- ❌ API returns null instead of numbers
- ❌ Database values don't match API values
- ❌ Timestamp on badge shows very old time (>1 hour)

---

## Success Criteria

**Demo is ready to go if:**
- ✅ All 5 checks pass
- ✅ Console is clean
- ✅ Data flows correctly
- ✅ MITRE answer prepared
- ✅ No new code added after verification

**Demo is NOT ready if:**
- ❌ Any check fails
- ❌ Console has errors
- ❌ Data mismatch found
- ❌ Untested new code added

---

**Owner Signature**: _________________  
**Date/Time Completed**: _________________  
**Result**: PASS ✅ / FAIL ❌ / CONDITIONAL ⚠️

