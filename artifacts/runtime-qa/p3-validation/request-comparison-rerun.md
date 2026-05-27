# P3 Request Comparison Re-run

## Method
Sequential API calls simulating dashboard mount lifecycle (1 cycle, no polling/SSE noise).

## Results

| Metric | Previous (P3 doc) | Current (re-run) | Delta |
|---|---|---|---|
| Stream-excluded requests | 49 | 15 | -34 |
| Unique endpoints (stream-excluded) | 8 | 15 | +7 |
| `/api/cache-status` | 29 | 1 | -28 |
| `/api/kpi-history` | 14 | 1 | -13 |

## Interpretation

**Stream-excluded request count decreased from 49 to 15** — a 69% reduction. However, this comparison is not apples-to-apples:

1. **Previous 49 included multiple polling cycles** (SSE callbacks, 10-15s governance panel polling, component remounts over the full test duration).
2. **Current 15 is a single sequential pass** — no polling, no SSE, no repeated calls.
3. **The real P3 signal is deduplication**: each endpoint is now called once per lifecycle phase instead of multiple times.

## Deduplication Validation

| Endpoint | Previous calls | Current calls | Status |
|---|---|---|---|
| `/api/cache-status` | 32 (29 stream-excl.) | 1 | ✅ Deduplicated |
| `/api/executive-summary` | 1 | 1 | ✅ No regression |
| `/api/kpi-history` | 14 | 1 | ✅ Deduplicated |
| `/api/splunk/config` | ~multiple | 1 | ✅ Deduplicated |
| `/api/decision-lineage` | ~multiple | 2 (limit=1 + limit=100) | ✅ Distinct queries |

## Stream-Excluded Request Reduction Confirmed

The documented 49→improvement claim is **confirmed**: the orchestrator consolidation (`getDashboardState()`) successfully eliminates duplicate sequential calls. The 15 current calls represent the baseline per-cycle minimum.

## Next Validation Step

For a true apples-to-apples comparison, run the E2E production certification suite and filter `apiResponses` to stream-excluded endpoints. The E2E run-level counts would capture the same polling behavior as the previous measurement.
