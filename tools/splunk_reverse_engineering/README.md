# Splunk Reverse Engineering Toolkit

Transform 1stmile_lookup.csv into a production-style Splunk demo environment.

## Quick Start

```bash
# 1. Analyze the CSV
python reverse_engineer_1stmile.py

# 2. Generate synthetic events
python generate_events.py

# 3. Create Splunk indexes
SPLUNK_HOST=144.202.48.85 SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram python create_indexes.py

# 4. Load events
SPLUNK_HOST=144.202.48.85 SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram python load_events.py

# 5. Create knowledge objects
SPLUNK_HOST=144.202.48.85 SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram python create_knowledge_objects.py

# 6. Validate
SPLUNK_HOST=144.202.48.85 SPLUNK_PORT=8089 \
SPLUNK_USERNAME=ram python validate_demo_environment.py
```

## Files

| Script | Purpose |
|--------|---------|
| `reverse_engineer_1stmile.py` | Parse CSV, generate expected_summary.json |
| `generate_events.py` | Create synthetic log events (3 NDJSON files) |
| `create_indexes.py` | Create customer + demo indexes in Splunk |
| `load_events.py` | Load NDJSON events into Splunk indexes |
| `create_knowledge_objects.py` | Create macros, saved searches, dashboard |
| `reset_demo_environment.py` | Safe cleanup of demo data |
| `validate_demo_environment.py` | Verify everything is correct |

## Outputs

| File | Contents |
|------|----------|
| `output/expected_summary.json` | CSV metadata summary (rows, indexes, volume, etc.) |
| `output/customer_events.ndjson` | Log events for customer indexes |
| `output/internal_volume_events.ndjson` | Volume metadata (datasensai_internal_sim) |
| `output/audit_search_events.ndjson` | Search activity (datasensai_audit_sim) |

## Environment Variables

Required:
- `SPLUNK_HOST` - Splunk instance IP/hostname
- `SPLUNK_PORT` - Splunk management port (usually 8089)
- `SPLUNK_USERNAME` - Admin username

Optional:
- `SPLUNK_PASSWORD` - If not provided, will prompt
- `SPLUNK_SCHEME` - http or https (default: https)
- `SPLUNK_VERIFY_SSL` - true/false (default: false for self-signed)
- `DATASENSAI_MODE` - demo or production (default: demo)
- `CONFIRM_RESET_DATASENSAI_DEMO` - true (required for reset script)

## Safety Features

✓ Dry-run mode by default (--dry-run flag)  
✓ All synthetic data marked with `datasensai_synthetic=true`  
✓ All demo indexes prefixed with `datasensai_`  
✓ Never modifies _internal or _audit  
✓ Requires explicit CONFIRM_RESET_DATASENSAI_DEMO=true to reset  
✓ Comprehensive validation before cleanup  

## CSV Stats

- **Rows:** 3,748
- **Indexes:** 19
- **Sourcetypes:** 176
- **Sources:** 3,194
- **Total Daily GB:** ~159.93

## Demo Architecture

```
1stmile_lookup.csv
       ↓
[reverse_engineer]
       ↓
expected_summary.json
       ↓
[generate_events]
       ↓
customer_events.ndjson
internal_volume_events.ndjson
audit_search_events.ndjson
       ↓
[create_indexes + load_events]
       ↓
Splunk Demo Environment:
  - datasensai_internal_sim (volume metadata)
  - datasensai_audit_sim (search activity)
  - oswin, apptomcat, appapache, ... (customer indexes)
       ↓
[create_knowledge_objects]
       ↓
datasensai_demo app:
  - Macros (datasensai_internal_index, etc.)
  - Saved searches
  - Dashboard
       ↓
[Agent queries via MCP/REST]
       ↓
Dashboard values (NOT from CSV)
```

## Next Steps

See `docs/SPLUNK_REVERSE_ENGINEERING_RUNBOOK.md` for detailed walkthrough.

See `docs/SPLUNK_DEMO_VALIDATION_CHECKLIST.md` for step-by-step validation.
