# Splunk Reverse Engineering Runbook

## Problem Statement

**The Issue:**
You had a CSV lookup (1stmile_lookup.csv) containing summarized metadata about 19 indexes, 176 sourcetypes, and ~159.93 GB/day of volume. The dashboard was reading this CSV directly as a lookup, which meant:
- No real Splunk indexes or events
- No actual audit/search activity
- Agent couldn't query via MCP/REST APIs
- Scores were inaccurate due to missing data

**The Solution:**
Reverse-engineer the CSV into a production-style Splunk demo environment where:
- Real customer-like indexes exist with actual log events
- Real volume metadata is available in datasensai_internal_sim (simulating _internal)
- Real search activity is available in datasensai_audit_sim (simulating _audit)
- Agent queries Splunk via MCP/REST APIs, NOT the CSV
- All data is marked synthetic so cleanup is safe

---

## Architecture

### Demo Mode vs Production Mode

**Demo Mode** (for development/testing):
- Uses simulated Splunk indexes:
  - `datasensai_internal_sim` → volume metadata (replaces _internal)
  - `datasensai_audit_sim` → search activity (replaces _audit)
  - Customer indexes: oswin, apptomcat, appapache, osnix, netfw, wazuh-alerts, appengine, aws_logs, etc.
- Generated events marked `datasensai_synthetic=true`
- Safe to reset without affecting production
- Uses env var: `DATASENSAI_MODE=demo`

**Production Mode** (for real Splunk instances):
- Uses actual Splunk indexes:
  - `_internal` → real volume metadata
  - `_audit` → real search activity
  - Real customer indexes
- No generated/synthetic data
- Uses env var: `DATASENSAI_MODE=production`

### Macros for Mode-Agnostic Queries

Created in Splunk app `datasensai_demo`:

| Macro | Demo | Production |
|-------|------|------------|
| `datasensai_internal_index()` | datasensai_internal_sim | _internal |
| `datasensai_audit_index()` | datasensai_audit_sim | _audit |
| `datasensai_volume_field()` | GB_idx_st_s | gb |

Agent queries use these macros, so same SPL works in both modes.

---

## Step-by-Step Setup

### 1. Reset Old Dummy Data (SAFE)

```bash
cd ~/Desktop/Teja/Dashboards

# Dry-run first (shows what would be deleted)
SPLUNK_HOST=144.202.48.85 \
SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram \
SPLUNK_PASSWORD=yourpassword \
python tools/splunk_reverse_engineering/reset_demo_environment.py --dry-run

# Actually reset (only datasensai demo data)
CONFIRM_RESET_DATASENSAI_DEMO=true \
SPLUNK_HOST=144.202.48.85 \
SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram \
SPLUNK_PASSWORD=yourpassword \
python tools/splunk_reverse_engineering/reset_demo_environment.py
```

**Safety guarantees:**
- Never touches `_internal` or `_audit`
- Only deletes indexes created from the CSV
- Only deletes `datasensai_demo` app
- Requires explicit `CONFIRM_RESET_DATASENSAI_DEMO=true` env var

---

### 2. Reverse-Engineer CSV

```bash
python tools/splunk_reverse_engineering/reverse_engineer_1stmile.py
```

Output: `tools/splunk_reverse_engineering/output/expected_summary.json`

Contains:
- Row count
- Index count (19)
- Sourcetype count (176)
- Source count (3,194)
- Total daily GB (~159.93)
- Top 10 indexes/sourcetypes by volume
- All index names
- All sourcetype names

---

### 3. Generate Synthetic Events

```bash
python tools/splunk_reverse_engineering/generate_events.py
```

Outputs three NDJSON files in `tools/splunk_reverse_engineering/output/`:

**customer_events.ndjson** (3,700+ events)
- Realistic log entries per index/sourcetype
- Fields: index, sourcetype, source, host, _time, raw_message
- Includes: GB_idx_st_s, bytes_idx_st_s (volume metadata preserved)
- Marked: datasensai_synthetic=true

**internal_volume_events.ndjson** (3,700+ events)
- Simulates Splunk's _internal index volume metadata
- Fields: index, sourcetype, source, b (bytes), gb (GB), license_pool
- For demo mode queries to measure index/sourcetype volume

**audit_search_events.ndjson** (500+ events)
- Simulates Splunk's _audit index search activity
- Fields: user, action=search, sourcetype_accessed, total_run_time, result_count
- Varied search frequency:
  - Top 5 sourcetypes: 20-40 searches (heavily used)
  - Next 10: 5-15 searches (medium use)
  - Others: 0-5 searches (some unused, good for optimization candidates)

---

### 4. Create Splunk Indexes

```bash
SPLUNK_HOST=144.202.48.85 \
SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram \
SPLUNK_PASSWORD=yourpassword \
DATASENSAI_MODE=demo \
python tools/splunk_reverse_engineering/create_indexes.py
```

Creates:
- datasensai_internal_sim (if demo mode)
- datasensai_audit_sim (if demo mode)
- All 19 customer indexes (oswin, apptomcat, appapache, osnix, netfw, wazuh-alerts, appengine, aws_logs, etc.)

---

### 5. Load Events into Splunk

```bash
# Option A: Via Splunk CLI (if available)
SPLUNK_HOME=/opt/splunk \
SPLUNK_HOST=144.202.48.85 \
python tools/splunk_reverse_engineering/load_events.py

# Option B: Via REST API (more portable)
SPLUNK_HOST=144.202.48.85 \
SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram \
SPLUNK_PASSWORD=yourpassword \
python tools/splunk_reverse_engineering/load_events.py --method=rest
```

Loads:
- customer_events.ndjson → individual customer indexes
- internal_volume_events.ndjson → datasensai_internal_sim
- audit_search_events.ndjson → datasensai_audit_sim

---

### 6. Create Knowledge Objects

```bash
SPLUNK_HOST=144.202.48.85 \
SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram \
SPLUNK_PASSWORD=yourpassword \
python tools/splunk_reverse_engineering/create_knowledge_objects.py
```

Creates in `datasensai_demo` app:

**Macros:**
- datasensai_internal_index()
- datasensai_audit_index()
- datasensai_volume_field()

**Saved Searches:**
- datasensai - Daily License Usage by Index
- datasensai - Search Utilization by Sourcetype
- datasensai - High Volume Low Search Coverage

**Dashboard:**
- datasensai_telemetry_value_dashboard
- Panels: Total GB, Index Count, Sourcetype Count, Top Indexes, Top Sourcetypes, etc.

---

### 7. Validate Everything

```bash
SPLUNK_HOST=144.202.48.85 \
SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram \
SPLUNK_PASSWORD=yourpassword \
DATASENSAI_MODE=demo \
python tools/splunk_reverse_engineering/validate_demo_environment.py
```

Checks:
- ✓ Indexes exist and have events
- ✓ Sourcetypes match expected count (176)
- ✓ Total daily GB matches expected (~159.93)
- ✓ Audit/search activity present
- ✓ Knowledge objects created
- ✓ Agent is NOT reading CSV directly

---

## Manual Splunk Validation (UI)

After loading events, validate in Splunk UI:

### Check customer indexes exist
Settings → Indexes, search for "oswin":
```
| tstats count where index=* by index
```
Expected: 19 indexes

### Check event volume
```
`datasensai_internal_index()`
| stats sum(`datasensai_volume_field()`) as total_gb
```
Expected: ~159.93 GB

### Check sourcetypes
```
`datasensai_internal_index()`
| stats count by sourcetype
```
Expected: ~176 sourcetypes

### Check search activity
```
`datasensai_audit_index()` action=search
| stats count by sourcetype_accessed
```
Expected: varied, some high (20-40 searches), some zero (no searches)

### Check macros work
```
macro `datasensai_internal_index()`
```
Expected: returns "datasensai_internal_sim" in demo mode

---

## Key Safety Features

1. **Dry-run by default**
   - reset_demo_environment.py runs in dry-run mode without --force flag
   - Shows what would be deleted before actually deleting

2. **Synthetic data marking**
   - All generated events have `datasensai_synthetic=true`
   - All demo indexes have "datasensai_" prefix
   - Easy to identify and clean up

3. **Backup before reset**
   - Script suggests backup before running with --force
   - Splunk app configs exported first

4. **Production mode protection**
   - DATASENSAI_MODE=production disables synthetic data loading
   - Prevents accidental demo data in production

5. **Explicit confirmation**
   - CONFIRM_RESET_DATASENSAI_DEMO=true required for destructive operations
   - Environment variable is clear and explicit

---

## Troubleshooting

### Total GB doesn't match expected
Check for duplicates in CSV:
```bash
python tools/splunk_reverse_engineering/reverse_engineer_1stmile.py
```
Look for "Removed X duplicates" output.

### Sourcetype count mismatch
Some sourcetypes may not have generated events if GB was zero:
```bash
cat tools/splunk_reverse_engineering/output/expected_summary.json | grep "sourcetype_count"
```

### Agent still reads CSV
Search codebase:
```bash
grep -r "1stmile_lookup.csv" apps/
grep -r "inputlookup.*1stmile" splunk/
```
If found, update agent config to use macro `datasensai_internal_index()` instead.

### Macros not working
Check app install:
```
Settings → Apps → Installed Apps
```
Should see "datasensai_demo" app.

Check macro definition:
```
Settings → Advanced search → Search macros
```
Search for "datasensai_" to find all three macros.

---

## What NOT to Do

❌ **Don't** upload 1stmile_lookup.csv as a lookup  
→ It's only for seed data, not for the agent

❌ **Don't** hardcode _internal queries in production  
→ Use datasensai_internal_index() macro

❌ **Don't** use DATASENSAI_MODE=demo in production  
→ Always use =production for real Splunk

❌ **Don't** delete datasensai_internal_sim without backup  
→ All your volume data is there

❌ **Don't** forget CONFIRM_RESET_DATASENSAI_DEMO=true  
→ Script will refuse to run without it

---

## Success Criteria

After following these steps, you should be able to:

1. Run agent against demo Splunk instance
2. Agent queries datasensai_internal_sim via MCP/REST
3. Agent queries datasensai_audit_sim via MCP/REST
4. Dashboard shows values from real Splunk queries, NOT CSV
5. Validate script confirms all checks pass
6. Old dummy data is completely cleaned up
7. No duplicates in the data
8. Scores match expected values (when weightages are set correctly)

---

## Next: Production Readiness

Once demo validates:
1. Point agent to real _internal and _audit
2. Set DATASENSAI_MODE=production
3. Update macros to return real Splunk indexes
4. Re-validate with production data
5. Archive this demo environment

---

## Support

Files for reference:
- `expected_summary.json` - CSV analysis results
- `customer_events.ndjson` - Generated log events
- `internal_volume_events.ndjson` - Volume metadata
- `audit_search_events.ndjson` - Search activity
- `SPLUNK_DEMO_VALIDATION_CHECKLIST.md` - Step-by-step validation
