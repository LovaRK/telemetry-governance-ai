# Tally Checklist — datasensAI ↔ Data Sensei

How to prove the two systems agree, at identical config, on the same live
Splunk instance. Run after a clean refresh.

## Pre-flight (both systems, identical)

- [ ] Same Splunk instance, same hour (volumes drift over time)
- [ ] Cost basis **$183 / GB / year** on both
- [ ] Weights **Utilization 0.35 · Detection 0.40 · Quality 0.25**
- [ ] datasensAI: `node scripts/reset-demo-data.mjs` then **Refresh** (no stale rows)

## Generate the artifact

```bash
# agent-only:
node scripts/export-tally-report.mjs
# with Teja's export (CSV columns: index,composite):
node scripts/export-tally-report.mjs --datasensei datasensei_export.csv
# → artifacts/tally-report.csv and artifacts/tally-report.html
```

## Portfolio KPIs (record both)

| Metric | datasensAI | Data Sensei | Δ | Tol |
|---|---|---|---|---|
| ROI Score | | | | ±2 |
| GainScope % | | | | ±2 |
| Total GB/day | | | | ±2% |
| Index count | | | | exact |
| Sourcetype count | | | | exact |
| Low-Value spend | | | | ±2% |
| Tier distribution (C/I/N/L) | | | | ±1 each |
| Security gaps | | | | ±1 |
| Operational gaps | | | | ±1 |

## Index count regression check (the "57 vs 176" bug)

- [ ] UI index count == `scripts/env-prep/08-validate.mjs` count == Splunk
      `| eventcount summarize=false index=*`
- [ ] Run **Refresh 3×** → counts and KPIs identical each time (dedup proof)

## Hand spot-check — 3 sourcetypes vs the calc guide

Pull raw inputs from `artifacts/score-audit/<runId>.json`, recompute by hand,
agree to ±0.5:

- [ ] One **security** sourcetype (`WinEventLog:Security`) — detection
      potential/realized + hard rule
- [ ] One with **injected quality issues** — density × 2000, DateParser ×0.5
- [ ] One **plain app log** — utilization weighting + tier boundary

## B6.5 — MITRE coverage comparison (biggest demo risk)

For `WinEventLog:Security`, `cisco:asa`, `linux_secure`, record and explain
every difference **before** the call:

| Sourcetype | DS technique count | Agent technique count | DS coverage % | Agent coverage % | Cause of Δ |
|---|---|---|---|---|---|
| WinEventLog:Security | | | | | |
| cisco:asa | | | | | |
| linux_secure | | | | | |

Likely benign causes: our MITRE/Lantern **baseline table** vs Teja's lookup;
index-level vs sourcetype-level attribution; alert-count normalization.

## Known measurement difference to pre-flag

GB/day can differ up to ~2%: `getIndexMetrics` takes
`max(metadata, license_usage, sampled)` whereas Data Sensei reads
`GB_idx_st_s`. Flag this to Teja up front so it isn't mistaken for a bug.

## Filter-bar live check

- [ ] Change cost 183 → 3650: Low-Value spend scales ~×20 **instantly**, no
      pipeline run
- [ ] Change weights: tier counts shift live
- [ ] Reset to defaults: matches the stored snapshot
