# Dashboard Bug Register (V3/V4 Alignment)

## P0 (Blockers)

1. Pipeline/Snapshot mixing
- Bug: `cache-status` blends published values with active run/job progression.
- Fix: split API response into `publishedState` and `activeState`; render charts/KPIs from `publishedState` only.

2. Decision hash invariant
- Bug: `decisionCount > 0` with `decisionHash = null`.
- Fix: enforce contract and fail run publish with `FAILED_CONTRACT` when violated.

3. Fallback decision contamination
- Bug: tutorial/fallback decisions appear in production dashboards.
- Fix: remove fallback decision generation entirely; use `FAILED_MODEL_UNAVAILABLE` when local LLM is unavailable.

4. KPI trends empty
- Bug: 7d/30d/90d cards render empty without explicit reason.
- Fix: return historical timeseries from `dashboard_snapshots`; if points < 2, render `Insufficient history`.

## Formula-specific fixes

1. ROI Score
- Expected: `avg(composite_score)` per published snapshot.
- Remove defaults/hardcoded values.

2. GainScope
- Expected: `(Tier1+Tier2 GB / Total GB) * 100`.

3. Detection
- Expected: `0.40 * potential + 0.60 * realized`.

4. Quality
- Expected: `max(0, 100 - issue_density * 2000)` where `issue_density = weighted_issues / approx_events`.

5. Composite
- Expected: `0.35U + 0.40D + 0.25Q`.

6. Cost model
- Canonical unit must be explicit and consistent (`cost_per_gb_year`, default 3650).

## Graph-level defects

1. ROI gauge
- Fix binding to published snapshot + formula drawer.

2. GainScope gauge
- Fix tier-volume calculation source.

3. Low-value spend
- Fix annualized calculation for low-value tiers only.

4. Savings potential
- Split retention/field/optimization savings sources.

5. Coverage gaps
- Keep two-row responsive layout and correct confidence scaling (0..100 only).

6. KPI trends 7/30/90
- Wire historical API; no placeholder data.

7. Utilization x Detection scatter
- X=utilization, Y=detection, bubble size=daily_gb, color=tier.

8. Tier distribution / score profile / annual spend by tier
- Remove placeholder rows; render explicit empty state only.

9. Telemetry detail rows
- Add explainability fields: value, formula, source, snapshotId, runId, confidence reason.

10. Governance pending review
- Show only when approval record exists in workflow table.
