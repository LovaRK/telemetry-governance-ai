# P0.9: Dashboard Audit (All 5 Tabs)

**Date**: 2026-06-03  
**Status**: ✅ AUDIT FRAMEWORK COMPLETE  
**Purpose**: Systematically verify all 5 dashboard tabs are clean (no TODOs, mock data, placeholder text)

---

## Pre-Demo Audit Requirements

**For Each Tab: Executive, Telemetry, Detail, Governance, Enhanced Views**

Apply this checklist. Any ❌ = BLOCKER.

---

## TAB 1: Executive Overview

### Visual Elements
- [ ] All KPI cards present (ROI, GainScope, Storage Savings, License Spend, Tier Spend, Confidence)
- [ ] No loading spinners (data is loaded)
- [ ] No "Loading..." text
- [ ] No "TBD", "N/A", "Coming Soon" text
- [ ] No placeholder values (e.g., "0.0", "—", "--")
- [ ] All metric numbers displayed with correct formatting (2 decimal places, $ signs, % signs)
- [ ] No broken images or missing icons

### Formula Verification
- [ ] Each metric has "ⓘ Explain" button
- [ ] Clicking explains the formula
- [ ] Formula explanation shows component values
- [ ] Values in explanation match database values

### Data Provenance
- [ ] Source table shown (e.g., "Source: scored_results")
- [ ] Pipeline run ID visible (e.g., "run_20260603_001")
- [ ] Timestamp shown and formatted correctly (e.g., "2 min ago")
- [ ] Confidence percentage shown
- [ ] Provenance visible without clicking (badge) or on hover

### Interactivity
- [ ] Range selector (7d/30d/90d) present and working
- [ ] Selecting different range updates displayed values
- [ ] Refresh button present and functional
- [ ] Refresh updates all metrics
- [ ] No errors during/after refresh

### Tier Spend Breakdown
- [ ] 4 tier cards visible (Tier 1/2/3/4)
- [ ] Each shows count (e.g., "23 Critical")
- [ ] Each shows annual spend (e.g., "$425K")
- [ ] Tier color coding correct (Red=T1, Orange=T2, Yellow=T3, Gray=T4)
- [ ] No hardcoded numbers

### Quality Checks
- [ ] No console errors (`F12` → Console tab)
- [ ] No React hydration warnings
- [ ] No undefined/null values rendering
- [ ] Page loads in <2 seconds
- [ ] All fonts load correctly
- [ ] All colors render correctly

### Content Audit
- [ ] No TODO comments visible
- [ ] No "FIXME" text
- [ ] No "Mock data" labels
- [ ] No "Demo only" text
- [ ] All text is grammatically correct
- [ ] No typos

---

## TAB 2: Telemetry

### Visual Elements
- [ ] Data table visible with all sourcetypes
- [ ] Columns present: Sourcetype, Daily GB, Searches, Dashboards, Scheduled, Users, Tier, Composite, Status
- [ ] No loading spinners
- [ ] No "Loading..." text
- [ ] All rows have data (no blank rows)
- [ ] No "N/A" or "—" in status column

### Data Content
- [ ] Daily GB values are non-zero and realistic (>0)
- [ ] Cost values match known annual costs
- [ ] Tier assignments correct (65/40/20 thresholds)
- [ ] Composite score formula verified (visible on hover or in modal)
- [ ] All rows show provenance (source, timestamp, confidence)

### Sorting/Filtering
- [ ] Column headers are clickable (sortable)
- [ ] Can sort by Composite score (descending shows Tier 1 first)
- [ ] Can sort by Tier (shows grouped correctly)
- [ ] Filter by tier working (if implemented)
- [ ] Search by sourcetype working (if implemented)

### Drill-Down
- [ ] Click on sourcetype row → goes to Detail tab
- [ ] Breadcrumb shows navigation: "Dashboard > endpoint:edr"
- [ ] Back button returns to Telemetry
- [ ] Drill-down values match detail page

### Quality Checks
- [ ] No console errors
- [ ] Table renders smoothly (no scroll lag)
- [ ] No overlapping text
- [ ] Responsive on different screen sizes

### Content Audit
- [ ] No TODO or FIXME comments
- [ ] No mock data labels
- [ ] All values from actual database
- [ ] Pagination or virtualization (if large dataset) working

---

## TAB 3: Detail (Sourcetype Drill-Down)

### Visual Elements
- [ ] Header shows selected sourcetype name
- [ ] Breadcrumb navigation present: "Dashboard > [Sourcetype]"
- [ ] Back button present and functional
- [ ] All dimension scores displayed (Utilization, Detection, Quality, Composite)
- [ ] Scores formatted with 1 decimal place
- [ ] Score colors correct (green=high, yellow=medium, red=low)

### Dimension Breakdown
- [ ] Utilization score shown with components:
  - [ ] Alerts count
  - [ ] Scheduled searches count
  - [ ] Dashboards count
  - [ ] Ad-hoc searches count
  - [ ] Unique users count
- [ ] Detection score shown with components:
  - [ ] MITRE techniques count
  - [ ] Lantern use cases count
  - [ ] Alert detection %
- [ ] Quality score shown with components:
  - [ ] Parsing errors count
  - [ ] Date parsing errors count
  - [ ] Quality percentage
- [ ] Each component has "ⓘ" to explain calculation

### Knowledge Objects
- [ ] Alerts section shows:
  - [ ] Count of detection alerts
  - [ ] Names of top 3 alerts (if available)
- [ ] Scheduled Searches section shows:
  - [ ] Count of scheduled searches
  - [ ] Names of top 3 searches (if available)
- [ ] Dashboards section shows:
  - [ ] Count of dashboard panels
  - [ ] Names of top 3 dashboards (if available)

### MITRE/Lantern Coverage
- [ ] MITRE techniques count displayed
- [ ] Lantern use cases count displayed
- [ ] Coverage percentage calculated correctly
- [ ] List of detected techniques (if expanded)
- [ ] Gap analysis available (what's NOT detected)

### Data Quality
- [ ] Parsing errors count shown
- [ ] Date errors count shown
- [ ] Error rate percentage calculated
- [ ] Recommendations shown if errors above threshold

### Tier & Actions
- [ ] Tier assignment shown (1, 2, 3, or 4)
- [ ] Tier-based recommendation displayed:
  - [ ] Tier 1: "Keep this — mission critical"
  - [ ] Tier 2: "Good value — actively used"
  - [ ] Tier 3: "Review for optimization"
  - [ ] Tier 4: "Consider archival or elimination"
- [ ] Annual cost breakdown shown
- [ ] Potential savings calculated (if Tier 3/4)

### Provenance
- [ ] Source table shown
- [ ] Pipeline run ID visible
- [ ] Generated timestamp shown
- [ ] Confidence percentage shown
- [ ] Data freshness indicator (e.g., "2 min ago")

### Quality Checks
- [ ] No console errors
- [ ] Page loads in <1 second
- [ ] All calculations correct (spot-check 3 values against database)
- [ ] Numbers match database exactly

### Content Audit
- [ ] No TODO or FIXME
- [ ] No mock data
- [ ] No placeholder text
- [ ] All text complete and grammatically correct

---

## TAB 4: Governance

### Visual Elements
- [ ] Title/header present: "Governance & Compliance"
- [ ] No loading spinners
- [ ] All sections visible without scrolling (or organized tabs)

### Sections Present
- [ ] Policy Compliance section
  - [ ] Shows compliance status
  - [ ] Lists policies and adherence
  - [ ] No "Coming Soon" text
- [ ] Audit Trail section
  - [ ] Shows recent actions/changes
  - [ ] Timestamp on each entry
  - [ ] No mock/test data
- [ ] Data Lineage section
  - [ ] Shows data flow: Source → Processing → Dashboard
  - [ ] Timestamp at each stage
  - [ ] Status indicators (success/failure)
- [ ] Change Log section
  - [ ] Shows formula/configuration changes
  - [ ] Date and author of each change
  - [ ] Impact assessment (if available)

### Content Verification
- [ ] All compliance statuses are accurate
- [ ] Audit entries match actual system changes
- [ ] Data lineage shows real pipeline runs
- [ ] Change log matches code commits
- [ ] No hardcoded/fake data

### Quality Checks
- [ ] No console errors
- [ ] Timestamps formatted consistently
- [ ] No broken links
- [ ] Modal/popover explanations working (if present)

### Content Audit
- [ ] No TODO, FIXME, or placeholder text
- [ ] All labels complete
- [ ] No "Demo Mode" indicators
- [ ] All data from actual sources

---

## TAB 5: Enhanced Views

### Section: Advanced Analytics (if present)
- [ ] Title/description present
- [ ] Visualizations render correctly (no blank charts)
- [ ] Chart titles descriptive
- [ ] Axes labeled
- [ ] Legend visible and accurate
- [ ] No "Coming Soon" overlays
- [ ] Data matches database

### Section: Recommendations (if present)
- [ ] Top opportunities listed (e.g., "Top 3 optimization targets")
- [ ] Each includes:
  - [ ] Sourcetype/element name
  - [ ] Reason for recommendation
  - [ ] Potential savings/impact
  - [ ] Recommended action
- [ ] No generic/placeholder text
- [ ] Recommendations are data-driven (not hardcoded)

### Section: Trend Analysis (if present)
- [ ] Timeline selector (7d/30d/90d) working
- [ ] Trends displayed as line/area chart
- [ ] Trend direction indicators (↑ up, ↓ down)
- [ ] Percentage change shown
- [ ] Trend confidence/volatility indicator

### Section: Comparison View (if present)
- [ ] Comparison period selectable (e.g., "vs. last month")
- [ ] Side-by-side comparison showing:
  - [ ] Previous period value
  - [ ] Current period value
  - [ ] % change
  - [ ] Trend direction
- [ ] No mock data

### Section: Custom Reports (if present)
- [ ] Report generation working
- [ ] Date range selectable
- [ ] Report includes all relevant KPIs
- [ ] Export to PDF/CSV working (if available)
- [ ] No placeholder content

### Quality Checks
- [ ] No console errors
- [ ] Charts render without flickering
- [ ] Data updates with range selector
- [ ] Responsive design (works on mobile, tablet, desktop)

### Content Audit
- [ ] No TODO, FIXME, placeholder
- [ ] All titles descriptive
- [ ] All numbers from database
- [ ] No "Demo Only" text

---

## Cross-Tab Verification

### Navigation
- [ ] All 5 tabs clickable from main navigation
- [ ] Active tab highlighted correctly
- [ ] Tab switching doesn't lose state
- [ ] Back button works between tabs
- [ ] Breadcrumb navigation works

### Consistent Styling
- [ ] Fonts consistent across tabs
- [ ] Colors match brand guidelines
- [ ] Spacing/padding consistent
- [ ] Card designs uniform
- [ ] Buttons style consistent

### Consistent Data
- [ ] Sourcetype names match across all tabs
- [ ] Tier assignments match across tabs
- [ ] Composite scores match across tabs
- [ ] Provenance data consistent

### Performance
- [ ] Initial load <2 seconds
- [ ] Tab switching <500ms
- [ ] Drill-down navigation <500ms
- [ ] No lag or jank
- [ ] Responsive to user interactions

### Accessibility
- [ ] Tab keyboard navigation works
- [ ] Buttons keyboard accessible
- [ ] Form fields labeled correctly
- [ ] Color contrast adequate
- [ ] No missing alt text on images

---

## Browser Console Check

Open `F12` → Console tab and verify:

- [ ] No red errors (✗ symbols)
- [ ] No yellow warnings
- [ ] No "Uncaught" exceptions
- [ ] No "Cannot find module" errors
- [ ] No "undefined is not a function" errors
- [ ] No "null reference" errors
- [ ] No hydration warnings (React)
- [ ] No deprecated API usage warnings

**Action**: If any errors present, debug and fix before demo.

---

## Final Cleanliness Checklist

**Across ALL 5 tabs**, verify ZERO of these exist:

- [ ] ❌ "TODO" comments
- [ ] ❌ "FIXME" labels
- [ ] ❌ "Coming Soon" text
- [ ] ❌ "Demo Mode" indicators
- [ ] ❌ "Mock data" labels
- [ ] ❌ "TBD" or "N/A" in customer-visible fields
- [ ] ❌ Hardcoded metric numbers (e.g., "52.3")
- [ ] ❌ Placeholder text (e.g., "Lorem ipsum")
- [ ] ❌ Broken images (404 errors)
- [ ] ❌ Missing fonts
- [ ] ❌ Unformatted numbers (e.g., "52.3000000001")
- [ ] ❌ Misaligned UI elements
- [ ] ❌ Inconsistent spacing
- [ ] ❌ Color shift/rendering errors
- [ ] ❌ Timeout spinners (>5 seconds)

**If ANY of these found**: Fix before demo.

---

## Audit Verification Workflow

**Phase 1: Automated Checks** (Run before manual audit)
```bash
# Check for TODO/FIXME/Coming Soon in codebase
grep -r "TODO\|FIXME\|Coming Soon" apps/web/pages/dashboard.tsx
grep -r "TODO\|FIXME\|Coming Soon" apps/web/components/dashboard

# Check for hardcoded metric numbers
grep -r "52\.3\|67\.0\|187" apps/web --include="*.tsx"

# Result: Should find NONE
```

**Phase 2: Manual Browser Audit** (User performs)
```
1. Open dashboard in browser
2. Go to Tab 1: Executive Overview
   - Run checklist above
   - Take screenshot
   - If all ✅, mark as PASS
   - If any ❌, note which items and debug

3. Repeat for Tab 2, 3, 4, 5

4. Run cross-tab verification
   - Navigation
   - Styling
   - Data consistency
   - Performance

5. Open console (F12)
   - Check for errors
   - Report any findings
```

**Phase 3: Documentation**
```
Create audit_results_YYYY_MM_DD.md with:
- Tab 1: PASS / FAIL (with issues noted)
- Tab 2: PASS / FAIL (with issues noted)
- Tab 3: PASS / FAIL (with issues noted)
- Tab 4: PASS / FAIL (with issues noted)
- Tab 5: PASS / FAIL (with issues noted)
- Cross-Tab: PASS / FAIL
- Console: PASS / FAIL
- Overall: GO / NO-GO
```

---

## Go/No-Go Decision

**DASHBOARD AUDIT: PASS** (Go to demo) when:
- ✅ All 5 tabs verified via checklist
- ✅ All items checked (no ⏳ pending)
- ✅ Zero blockers (no ❌)
- ✅ Console clean (no errors)
- ✅ All data from actual database (no mock/hardcoded)

**DASHBOARD AUDIT: FAIL** (Do not demo) if:
- ❌ Any tab missing required sections
- ❌ Any TODO/FIXME/Coming Soon text visible
- ❌ Any hardcoded metric values
- ❌ Any console errors
- ❌ Any broken links/images
- ❌ Any misaligned UI
- ❌ Any timeout/hanging spinners

---

## Notes for Next Verification Session

When ready to run full audit:
1. Use this checklist as reference
2. Go through each tab systematically
3. Take screenshots of each section
4. Note any issues found
5. Create audit report

**Expected Time**: 30-45 minutes for complete audit
**Blocker Risk**: High (visual inspection catches UI bugs)
**Confidence**: High (checklist is comprehensive)

---

**Status**: Audit framework complete. Awaiting manual verification in browser.
