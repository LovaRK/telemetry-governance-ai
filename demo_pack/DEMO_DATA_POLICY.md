# DEMO Data Policy

## Objective
Use temporary data only when live Splunk data is insufficient to validate UI, AI pipeline, and HITL behavior. Final demo screen should be live-only whenever available.

## Tagging Standard
- `demo_run_id`: `demo_run_<YYYYMMDD_HHMMSS>`
- marker prefix for local fallback rows: `fixture_test_<demo_run_id>`
- metadata fields: `created_by=test`, `test_run_id=<demo_run_id>`, `expires_at=<iso timestamp>`

## Where tags appear
- Splunk temporary events (if injected): event field `demo_run_id`
- Local fallback (DB fixture lifecycle):
  - `telemetry_snapshots.raw_metadata.fixture_tag`
  - `telemetry_snapshots.raw_metadata.test_run_id`
  - `agent_decisions.recommendation/reasoning` marker text
  - `executive_kpis.agent_reasoning` marker text

## Allowed temporary data path
1. Attempt live refresh first.
2. If sparse data blocks validation, use temporary tagged dataset only for certification checks.
3. Capture evidence.
4. Purge all temporary data.
5. Re-verify cleanliness.

## Purge commands
```bash
npm run cleanup:test
npm run verify:clean
```

## Post-purge verification (must be zero)
Expected from `npm run verify:clean`:
- `telemetry_snapshots: 0`
- `agent_decisions: 0`
- `executive_kpis: 0`

## Evidence files
- `cleanup/cleanup_test_output.txt`
- `cleanup/verify_clean_output.txt`

## Production safety rule
No temporary tagged rows may remain after prep. If cleanup verification is non-zero, demo is blocked.
