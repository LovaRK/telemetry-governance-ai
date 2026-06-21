# Splunk Demo Environment Preparation

Reproducible scripts that turn the 1stMile lookup CSVs (in `seed-data/`) into a
realistic Splunk demo environment: indexes, events, knowledge objects, organic
data-quality issues, and ad-hoc usage signals — everything datasensAI (and
Teja's Data Sensei) needs to score against live data.

## Prerequisites

A reachable Splunk instance and admin credentials. **Credentials are read from
the environment — never hardcoded.**

```bash
export SPLUNK_URL="https://<host>:8089"   # management port
export SPLUNK_USER="<admin>"
export SPLUNK_PASSWORD="<password>"
```

A valid Splunk **Enterprise license** is required: Splunk Free / an expired
trial blocks all search-time commands (`litsearch`), so scoring and validation
return zero even though events are indexed.

## One-shot run

```bash
node scripts/env-prep/run-all.mjs --dry-run   # plan everything, change nothing
node scripts/env-prep/run-all.mjs             # full run + validation
node scripts/env-prep/run-all.mjs --skip-wipe # additive (keep existing data)
```

## Steps (run individually if needed)

| Script | Purpose |
|--------|---------|
| `01-parse-csvs.mjs` | Parse `seed-data/*.csv.gz` → `manifest.json` (the source of truth for every later step) |
| `02-wipe.mjs` | Delete the `datasense_demo` app + manifest indexes. `--include a,b` to also drop named legacy/dummy indexes. Never touches `_*`/system indexes |
| `03-create-indexes.mjs` | Create indexes with retention from the metadata CSV |
| `04-hec-setup.mjs` | Enable HEC + token; auto-falls back to `/services/receivers/simple` if port 8088 is firewalled |
| `05-generate-events.mjs` | Realistic per-sourcetype events scaled to `TOTAL_DAILY_GB`; injects malformed events for quality-CSV sourcetypes so `_internal` parsing warnings arise organically |
| `06-create-knowledge-objects.mjs` | Saved searches (scheduled + alerts), dashboards, macros, eventtypes, tags. Every SPL carries a literal `index=` token so the attribution regex credits it |
| `07-generate-usage.mjs` | Runs ad-hoc searches via the search API → organic `_audit` usage signals (feeds utilization adhoc/users). Set `ANALYST_PASSWORD` to also run as a second user |
| `08-validate.mjs` | Queries Splunk back; prints expected-vs-actual; non-zero exit on mismatch |

## Tunables (env)

| Var | Default | Effect |
|-----|---------|--------|
| `TOTAL_DAILY_GB` | `0.25` | Total synthetic volume (proportions preserved from the CSVs) |
| `MAX_EVENTS_TOTAL` | `200000` | Hard cap on generated events |
| `USAGE_SCALE` | `0.05` | Fraction of source ad-hoc counts to replay |
| `USAGE_FLOOR` | `2` | Minimum ad-hoc searches per index |
| `ANALYST_PASSWORD` | — | Create + search as `analyst1` (distinct-user signal > 1) |
| `HEC_PORT` | `8088` | HEC probe port |
| `SEED_DATA_DIR` | `<repo>/seed-data` | Override seed location |

## Note on absolute volume

Synthetic GB is a small, configurable fraction of 1stMile production. This is
intentional: datasensAI and Data Sensei read the **same** live instance, so the
tally is internally consistent, and the relative scores + ratio KPIs (ROI,
GainScope) are scale-independent.
