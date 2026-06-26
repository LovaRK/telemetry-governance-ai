# Splunk Demo Environment Validation Checklist

Use this checklist to verify the demo environment is production-ready before testing the agent.

## Phase 1: CSV Analysis ✓
- [x] CSV has 3,748 rows
- [x] CSV has 19 indexes
- [x] CSV has 176 sourcetypes
- [x] CSV has 3,194 sources
- [x] Total daily GB ≈ 159.93
- [x] expected_summary.json generated correctly

## Phase 2: Event Generation ✓
- [x] customer_events.ndjson generated (14,950+ events)
- [x] internal_volume_events.ndjson generated (3,748+ events)
- [x] audit_search_events.ndjson generated (600+ events)
- [x] All events include `datasensai_run_id`
- [x] All events include `datasensai_synthetic=true`
- [x] Run ID explicitly set: `export DATASENSAI_RUN_ID=1stmile-demo-20260626-001`

## Phase 3: Static Validation (No Splunk)
Run before connecting to 144.202.48.85:

```bash
python tools/splunk_reverse_engineering/validate_demo_environment.py --static-only
```

Expected output:
```
✓ expected_summary.json exists
✓ customer_events.ndjson has datasensai_run_id and datasensai_synthetic=true
✓ internal_volume_events.ndjson has datasensai_run_id and datasensai_synthetic=true
✓ audit_search_events.ndjson has datasensai_run_id and datasensai_synthetic=true
✓ Agent doesn't read CSV
```

**Checklist:**
- [ ] Static validation passes
- [ ] Agent doesn't read `1stmile_lookup.csv`
- [ ] Agent doesn't use `inputlookup 1stmile`

## Phase 4: Dry-Run Validation
Set Splunk env vars and run dry-runs:

```bash
export SPLUNK_HOST=144.202.48.85
export SPLUNK_PORT=8089
export SPLUNK_USERNAME=ram
export SPLUNK_PASSWORD=<password>
export DATASENSAI_MODE=demo
export DATASENSAI_RUN_ID=1stmile-demo-20260626-001

# Check what would be created/loaded
python tools/splunk_reverse_engineering/create_indexes.py --dry-run
python tools/splunk_reverse_engineering/load_events.py --dry-run
python tools/splunk_reverse_engineering/reset_demo_environment.py --dry-run
```

**Checklist:**
- [ ] create_indexes would create 21 indexes (19 customer + 2 demo)
- [ ] create_indexes would NOT delete _internal or _audit
- [ ] load_events shows HEC event envelope structure correct
- [ ] load_events includes datasensai_run_id in envelope
- [ ] reset_demo would only delete demo-created indexes

## Phase 5: Index Creation (First Actual Step)
Once dry-run looks good:

```bash
python tools/splunk_reverse_engineering/create_indexes.py --force
```

**Checklist:**
- [ ] All 21 indexes created
- [ ] No errors for system index names
- [ ] Can see new indexes in Splunk UI: Settings → Indexes

## Phase 6: Event Loading
```bash
python tools/splunk_reverse_engineering/load_events.py --force
```

**Checklist:**
- [ ] ~19,331 events loaded total
- [ ] No HEC errors
- [ ] Events appear in customer indexes: `| tstats count where index=oswin`

## Phase 7: Splunk Validation
Verify in Splunk UI (Settings → Search):

### Total Volume Check
```spl
`datasensai_volume_search` datasensai_run_id="1stmile-demo-20260626-001"
| stats sum(`datasensai_volume_field()`) as total_gb
```
**Expected:** ~159.93 GB

### Index Count Check
```spl
`datasensai_volume_search` datasensai_run_id="1stmile-demo-20260626-001"
| stats count(distinct index) as index_count
```
**Expected:** 19

### Sourcetype Count Check
```spl
`datasensai_volume_search` datasensai_run_id="1stmile-demo-20260626-001"
| stats count(distinct sourcetype) as sourcetype_count
```
**Expected:** 176

### Macros Work
```spl
`datasensai_volume_search` datasensai_run_id="1stmile-demo-20260626-001"
| head 1
```
**Expected:** Returns one event

### Audit Activity Present
```spl
`datasensai_audit_search` datasensai_run_id="1stmile-demo-20260626-001"
| stats count by sourcetype_accessed
```
**Expected:** Multiple rows, some with 0 searches

### Customer Indexes Have Events
```spl
`datasensai_customer_search` datasensai_run_id="1stmile-demo-20260626-001"
| stats count by index
```
**Expected:** 19 indexes with event counts

**Checklist:**
- [ ] Total volume ≈ 159.93 GB
- [ ] Index count = 19
- [ ] Sourcetype count = 176
- [ ] Macros expand correctly
- [ ] Audit data shows search activity
- [ ] Customer indexes populated
- [ ] All queries filter by datasensai_run_id

## Phase 8: Dashboard Verification
Navigate to: Home → datasensai_demo app → datasensai_telemetry_value_dashboard

**Checklist:**
- [ ] Total Daily GB displays ~159.93
- [ ] Index Count displays 19
- [ ] Sourcetype Count displays 176
- [ ] Top 10 Indexes by Volume shows oswin (highest)
- [ ] Top 10 Sourcetypes by Volume correct
- [ ] High Volume Low Search Coverage shows candidates
- [ ] Search Utilization chart has all 4 categories

## Phase 9: Duplicate Load Test (Critical!)
Test that run_id filtering prevents data corruption on second load:

```bash
# First run (already done)
# Total GB should be 159.93

# Change run_id for second load
export DATASENSAI_RUN_ID=1stmile-demo-20260626-002

# Generate events with new run_id
python tools/splunk_reverse_engineering/generate_events.py

# Load with new run_id
python tools/splunk_reverse_engineering/load_events.py --force

# Verify each run_id separately:
# With run_id 001:
`datasensai_volume_search` datasensai_run_id="1stmile-demo-20260626-001"
| stats sum(`datasensai_volume_field()`) as total_gb

# With run_id 002:
`datasensai_volume_search` datasensai_run_id="1stmile-demo-20260626-002"
| stats sum(`datasensai_volume_field()`) as total_gb

# Both should return ~159.93 GB (NOT 319.86)
```

**Checklist:**
- [ ] Run ID 001 returns 159.93 GB
- [ ] Run ID 002 returns 159.93 GB (not 319.86)
- [ ] Duplicate loads don't corrupt scores

## Phase 10: Production Readiness
- [ ] All phases 1-9 passed
- [ ] No CSV usage in agent code
- [ ] Macros correctly use search fragments
- [ ] HEC envelopes have correct structure
- [ ] Reset script only touches demo indexes
- [ ] Validation detects CSV usage
- [ ] Agent can query via MCP/REST
- [ ] Dashboard displays accurate values from Splunk (not CSV)

---

## Troubleshooting

### Total GB doesn't match
- Check: Are both run_ids included in the query?
- Fix: Filter by explicit datasensai_run_id

### Sourcetypes missing
- Check: Some have 0 searches — did left-join happen?
- Fix: Use `| fillnull value=0 search_count`

### Macros don't expand
- Check: Settings → Advanced search → Search macros
- Fix: Verify macros.conf syntax is valid

### Duplicate-load corruption detected
- Issue: Second load doubled the GB
- Fix: Ensure DATASENSAI_RUN_ID is different per load
- Fix: All queries use datasensai_run_id filter

---

## Sign-Off

Once all phases pass:
1. Date: _______________
2. Run ID used: _________________
3. Total GB verified: _______________
4. Index count verified: _______________
5. Duplicate load test passed: Yes / No
6. All macros working: Yes / No
7. Dashboard displays correct values: Yes / No

**Ready to test agent:** ✓ YES  / ✗ NO
