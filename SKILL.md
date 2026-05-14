---
name: datasensai
description: Use when analyzing a customer's Splunk environment for data ROI / waste, running the datasensAI pipeline, building scoring lookups for the datasensAI Splunk app, generating an Executive Brief, or answering questions about datasensAI scoring methodology (utilization, detection, quality, composite, tiers, detection/operational gaps). Triggers include "datasensAI", "Splunk ROI scoring", "sourcetype tiering", "MITRE/Lantern coverage", "low-value Splunk data", "Splunk data optimization", "Splunk waste analysis".
---

# datasensAI — Splunk Data ROI Assessment Skill

datasensAI quantifies the business value of every sourcetype in a Splunk environment. For each sourcetype it computes Utilization, Detection, and Quality scores (0–100), combines them into a Composite Score, assigns a Tier (Critical / Important / Nice-to-Have / Wasteful), and surfaces the result in Splunk Dashboard Studio dashboards plus a branded Executive Brief PDF.

This skill is the complete operating guide: how the pieces fit together, every formula, every command an agent needs to run the pipeline, what to do with the output, and how to explain the numbers back to the customer.

## When to use this skill

Invoke when the user wants to:
- Assess a customer's Splunk ROI / find wasteful ingestion
- Run the Python pipeline (`pipeline.py`) end-to-end for a customer
- Refresh MITRE ATT&CK or Splunk Lantern lookups
- Push scored CSVs into the Splunk `datasensAI` app's lookups so dashboards update
- Generate a per-customer Executive Brief (HTML/PDF)
- Explain the scoring math, tier thresholds, or gap criteria
- Tune scoring weights, cost per GB, or gap thresholds for a customer
- Troubleshoot a pipeline run (missing CSVs, low resolution rate, zero scores, etc.)

Do **not** use this skill for unrelated Splunk topics (search optimization, app dev, SPL tuning), or for general "score this data" questions that aren't tied to the datasensAI pipeline.

---

## 1. Architecture (one diagram)

```
+------------------------+
|  Customer Splunk       |  Step 1: TA collects metadata
|  + TA-bitsIO-datasensAI|  via 11 saved searches → CSV lookups
+-----------+------------+
            |
            v   (Step 2: SCP / copy CSVs with customer prefix)
+------------------------+
|  python/input/         |
|    ACME_*.csv          |
+-----------+------------+
            |
            v   (Step 3: pipeline.py ACME_)
+------------------------+
|  Python Pipeline       |
|   - SPL Parser         |   Clean → Extract → Resolve
|   - Scoring Engine     |   Utilization + Detection + Quality
|   - Composite + Tier   |
|   - Recommendation     |   5-bullet rule-based recs
|   - Report Generator   |   HTML/PDF Executive Brief
+-----------+------------+
            |
            +--> python/output/ACME_/*.csv        (raw artifacts)
            |
            +--> [--push-to-splunk] $SPLUNK_HOME/etc/apps/datasensAI/lookups/
                 (multi-customer append, atomic write, locked, rotated backups)
            |
            v
+------------------------+
|  datasensAI Splunk App |
|    Executive dashboard |   ROI gauges, GainScope, low-value spend, tier mix
|    Detail dashboard    |   Per-sourcetype drilldowns, MITRE/Lantern, field gaps
|    Storage Cost demo   |   Field-level + retention savings
+------------------------+
```

---

## 2. Components

| Component | Path | Purpose |
|---|---|---|
| **TA-bitsIO-datasensAI** (v1.0.7) | Splunk app on the customer's search head | 11 saved searches that export metadata as CSV lookups |
| **datasensAI Splunk app** | `datasensAI/` (Dashboard Studio app) | Executive, Detail, Storage Cost dashboards + custom vizzes (gauge, radar, status board) |
| **Python pipeline** | `python/pipeline.py` | Reads CSVs → parses SPL → scores → writes outputs → optionally pushes to Splunk |
| **SPL Parser** | `python/spl_parser/` | `cleaner.py` → `extractor.py` → `resolver.py` → `parser.py` |
| **Scoring engine** | `python/scoring/` | `utilization.py`, `detection.py`, `quality.py`, `composite.py` |
| **Report generator** | `python/report_generator/` | Jinja2 HTML template + WeasyPrint PDF + recommendation engine |
| **MITRE builder** | `python/build_mitre_lookup.py` | Generates `sourcetype_attack_mapping.csv` from Splunk `security_content` repo |
| **Lantern builder** | `python/build_lantern_lookup.py` | Generates `sourcetype_lantern_mapping.csv` (162+ sourcetypes, 12 domains) |
| **Custom vizzes** | `viz-gauge`, `viz-radar_chart`, `viz-component_status_board` | Required by dashboards (install on Splunk) |

---

## 3. TA Inputs — CSVs Collected From The Customer

The TA produces these CSVs into `$SPLUNK_HOME/etc/apps/TA-bitsIO-datasensAI/lookups/`. Every file must be prefixed with the customer token (e.g., `ACME_`) when copied to `python/input/`.

| # | CSV (TA-side filename) | Contents | Used by |
|---|---|---|---|
| 1 | `index_sourcetype_and_source_volume_lookup.csv` | Daily GB per (index, sourcetype, source) | Cost, Quality denominator, channel-split |
| 2 | `dashboard_savedsearches_inventory_lookup.csv` | All saved searches + dashboard panels with SPL, type, app, owner, enabled | Utilization, Detection, SPL parser |
| 3 | `dashboard_adhoc_savedsearches_time_usage_lookup.csv` | Who ran which search, when | Utilization (unique user count) |
| 4 | `data_quality_issues_lookup.csv` | DateParser*, LineBreakingProcessor, etc. with hits per sourcetype | Quality |
| 5 | `index_metadata_lookup.csv` | Retention, sizes, SmartStore flag per index | Retention dashboards |
| 6 | `index_sourcetype_with_datamodels.csv` | Datamodel-to-sourcetype mapping | SPL parser (datamodel resolution) |
| 7 | `macros_inventory_lookup.csv` | Macro title + definition | SPL parser (macro resolution) |
| 8 | `sourcetype_fields_summary.csv` | Fields seen per sourcetype | Field usage gap analysis |
| 9 | `required_fields_for_each_datamodel.csv` | Fields required by each data model | Field gap context |
| 10 | `EventTypes.csv` | Eventtype definitions (eventtype, search) | SPL parser (eventtype chain) |
| 11 | `Tags_-_List_by_tag_name.csv` | Tag → field=value pairs | SPL parser (tag chain) |

Two more CSVs ship pre-built in the pipeline (regenerated rarely):
- `sourcetype_attack_mapping.csv` — MITRE technique counts per sourcetype pattern
- `sourcetype_lantern_mapping.csv` — Lantern use case counts per sourcetype across 12 domains

---

## 4. SPL Parser — Sourcetype Resolution

Before scoring, every saved search / dashboard panel is resolved to the set of sourcetypes it touches. Pipeline:

```
Raw SPL → Cleaner → Extractor → Resolver → (resolved_sourcetype, confidence, method)
```

Output row per (search, sourcetype) pair:
`search_name, search_type, app, owner, is_enabled, resolved_sourcetype, confidence, resolution_method, attribution_weight, spl_preview, unresolved_reason`

### Resolution methods (9)

| Method | Example | Confidence |
|---|---|---|
| `direct` | `sourcetype="WinEventLog:Security"` | HIGH |
| `index` | `index=main` (looked up via volume CSV) | MEDIUM |
| `source` | `source="/var/log/syslog"` | MEDIUM |
| `wildcard` | `sourcetype=cisco:*` (fanned out) | HIGH/MEDIUM |
| `macro` | `` `sysmon` `` (recursively expanded) | HIGH |
| `datamodel` | `\| tstats from datamodel=Endpoint.Processes` | HIGH |
| `eventtype` | `eventtype=attack` (definition resolved) | MEDIUM |
| `tag` | `tag=security` (tag → eventtype → sourcetype) | MEDIUM |
| `unresolved` | nothing resolves; written with `unresolved_reason` | LOW |

### Attribution weighting

When a single search fans out across N sourcetypes (e.g., a tag UNION or a wildcard), it contributes `1/N` to each — `attribution_weight` is used by Utilization so fuzzy attributions don't inflate every sourcetype they touch.

### Channel-based split

Sourcetypes in `channel_based_sourcetypes = ("XmlWinEventLog", "WinEventLog", "syslog")` with a colon-bearing `source` (e.g., `XmlWinEventLog:Security`) are **split** so each channel scores independently. The parent row is removed to avoid double counting.

---

## 5. Dimension 1 — Utilization Score (default weight 35%)

Question: *"How much is this sourcetype actually being used?"*

```
weighted_sum(st) =
      3 × alert_count(st)
    + 3 × scheduled_count(st)        # 'scheduler' is normalized to 'scheduled'
    + 2 × dashboard_count(st)
    + 1 × adhoc_count(st)
    + 2 × distinct_user_count(st)

utilization_score(st) = (weighted_sum(st) / max_weighted_sum) × 100
```

- Only `is_enabled` searches are counted.
- `UNRESOLVED` rows are dropped.
- Counts respect `attribution_weight` (fractional credit when one search hits N sourcetypes).
- Unique users come from the `search_usage` CSV, joined on `savedsearch_name`, then fall back to substring match against `search`.
- Score is normalized against the **max within this customer** — it's relative, not absolute.

Multipliers are configurable via `PipelineConfig.utilization_multipliers`.

---

## 6. Dimension 2 — Detection Score (default weight 40%)

Question: *"Does this sourcetype contribute to security or operational detection?"*

Two sub-components:

### 6a. Potential (sub-weight 40%)

```
mitre_potential   = min(100, technique_count × 1.25)
lantern_potential = min(100, lantern_usecase_count × 6.0)
potential         = max(mitre_potential, lantern_potential)
```

Take the **max** so non-security data (SAP, ServiceNow, VMware, IoT, OT, business logs) gets credit for operational use cases instead of scoring 0 on detection.

Sourcetype lookup falls back: exact → case-insensitive → fnmatch wildcard pattern → `XmlWinEventLog:X` retried as `WinEventLog:X`.

### 6b. Realized (sub-weight 60%)

```
realized(st) = (alert_count(st) / max_alert_count) × 100
```

`alert_count` includes:
- Explicit `search_type == "alert"`
- Scheduled searches whose `app` is in the security app list (ES, SA-*, infosec_app, phantom, soar, es_investigations)
- Scheduled searches whose **name** matches strong keywords (alert, detect, threat, attack, suspicious, malicious, brute, lateral, privilege, anomal, compromise, exploit, exfiltrat, intrusion, incident, forensic, investigat, impossible, improbable, logon, account, audit, denied, banned, blocked)
- Scheduled searches whose name matches weak keywords (access, login, failed, failure) **and** the owning app is a security app

All filtered to `is_enabled` only.

### 6c. Combined

```
detection_score(st) = (0.40 × potential) + (0.60 × realized)
```

**Hard rule:** if `technique_count == 0` AND `lantern_count == 0`, `detection_score = 0`. We refuse to invent detection value for data we genuinely don't know about.

### Two gap flags (both written to `scored_results.csv`)

| Flag | Trigger | Meaning |
|---|---|---|
| `detection_gap` | `technique_count >= 15` AND `coverage_pct < 25` where `coverage_pct = alert_count / technique_count × 100` | Security under-coverage — security-relevant data with no active detections |
| `operational_gap` | `lantern_usecase_count >= 4` AND `alert_count <= 0` | Operational under-coverage — IT Ops / business value left on the table |

All four thresholds configurable: `detection_gap_technique_minimum`, `detection_gap_coverage_threshold`, `operational_gap_lantern_minimum`, `operational_gap_alert_maximum`.

---

## 7. Dimension 3 — Quality Score (default weight 25%)

Question: *"Is the data clean and well-formed?"*

```
weighted_issues = Σ hits, where DateParserVerbose hits count at 0.5×

approx_events   = daily_gb × 1,000,000

issue_density   = weighted_issues / approx_events

quality_score   = max(0, 100 − (issue_density × 2000))
```

Edge cases:
- No issues → `quality_score = 100`
- Issues exist but no volume → `quality_score = 0` (worst case)
- Sourcetype in volume but not in quality CSV → defaults to `100`

`quality_scaling_factor` (default `2000`) is configurable.

Interpretation:
- **90–100**: Clean.
- **50–89**: Some parsing noise worth investigating.
- **0–49**: Significant data-quality problems affecting search accuracy.

---

## 8. Composite Score + Tier Assignment

```
composite = 0.35 × utilization + 0.40 × detection + 0.25 × quality
```

Weights sum to 1.0 (validated in `PipelineConfig.__post_init__`).

### Tier thresholds (current code defaults)

| Composite | Tier | Label | Recommended action |
|---|---|---|---|
| ≥ 65 | 1 | **Critical** | Protect — essential data |
| ≥ 40 | 2 | **Important** | Maintain — valuable data |
| ≥ 20 | 3 | **Nice-to-Have** | Optimize — reduce volume / retention |
| < 20 | 4 | **Wasteful** | Eliminate — high cost, low value |

These were **lowered from 75/50/25** because real customer top scores cluster in the 65–75 band after the parser's reality-check + attribution weighting; the old defaults produced empty Critical tiers. Override per customer if needed.

### Annual cost per sourcetype

```
annual_cost(st) = daily_gb(st) × cost_per_gb_year
```

`cost_per_gb_year` defaults to `3650` ($10/GB/day, legacy Splunk Enterprise rate). Real customer rates vary widely:
- Splunk Cloud workload pricing: ~$3–6/GB/day depending on SVC commit
- Enterprise high-volume / EA commits: often <$5/GB/day

Two ways to set it:
1. **Pipeline run** — pass via `PipelineConfig(cost_per_gb_year=...)` before computing the persisted `annual_cost` column.
2. **Dashboard view** — the Executive + Detail dashboards expose a `$cost_per_gb$` input token that recomputes display numbers without rerunning the pipeline.

### Composite NaN guard

If any dimension is NaN/None, `compute_composite_score` raises `ValueError` instead of silently producing a NaN composite that compares False against every threshold and dumps everything into Tier 4.

---

## 9. Outputs

### Per-customer (`python/output/<token>/`)

| File | Contents |
|---|---|
| `<token>scored_results.csv` | One row per sourcetype: scores, tier, daily_gb, annual_cost, detection_gap, operational_gap, plus the `customer` column |
| `<token>sourcetype_usage_resolved.csv` | One row per (search, sourcetype) pair with confidence and method |
| `<token>field_usage_gap.csv` | Per-sourcetype field optimization analysis (fields indexed vs used vs unused, % savings potential) |

### Splunk lookups (when `--push-to-splunk` is set)

Written to `$SPLUNK_HOME/etc/apps/datasensAI/lookups/`, multi-customer append, atomic write, file-locked, with rotated backups (`backup_retention` default 5):

- `datasensai_scored_results.csv`
- `datasensai_sourcetype_usage_resolved.csv`
- `datasensai_field_usage_gap.csv`
- All 11 input CSVs (so dashboards can drilldown into raw data)
- `sourcetype_attack_mapping.csv`
- `sourcetype_lantern_mapping.csv`

Existing rows for the same `customer` are removed before append (idempotent reruns).

---

## 10. End-to-End Operator Workflow

### Prerequisites
- Splunk Enterprise 9.x+ or Splunk Cloud (search head access)
- Python 3.9+ with pandas, jinja2 (`pip install -r python/requirements.txt`)
- Admin access to install Splunk apps
- The `Final/` release package (tarballs + docs)

### One-time setup

```bash
mkdir -p /opt/datasensAI && cd /opt/datasensAI
cp /path/to/Final/* .

# Extract the Python pipeline (analysis server)
tar -xzf datasensAI-python-pipeline.tar.gz

# Install the TA on the customer's Splunk search head
tar -xzf TA-bitsIO-datasensAI.tar.gz -C "$SPLUNK_HOME/etc/apps/"

# Install the datasensAI app (wherever you'll view dashboards)
tar -xzf datasensAI.tar.gz                 -C "$SPLUNK_HOME/etc/apps/"
tar -xzf viz-gauge.tar.gz                  -C "$SPLUNK_HOME/etc/apps/"
tar -xzf viz-radar_chart.tar.gz            -C "$SPLUNK_HOME/etc/apps/"
tar -xzf viz-component_status_board.tar.gz -C "$SPLUNK_HOME/etc/apps/"

"$SPLUNK_HOME/bin/splunk" restart
```

### Per-customer collection

1. On customer's Splunk Web → **Settings → Searches, Reports, and Alerts → App: TA-bitsIO-datasensAI**.
2. Run all 11 reports. They populate `$SPLUNK_HOME/etc/apps/TA-bitsIO-datasensAI/lookups/`.
3. Copy CSVs to the analysis server **with a customer token prefix**:

```bash
SPLUNK_LOOKUPS="$SPLUNK_HOME/etc/apps/TA-bitsIO-datasensAI/lookups"
PIPELINE_INPUT="/opt/datasensAI/python/input"
TOKEN="ACME_"   # alphanumeric/underscore/hyphen only; validated by PipelineConfig

for f in "$SPLUNK_LOOKUPS"/*.csv; do
  cp "$f" "$PIPELINE_INPUT/${TOKEN}$(basename "$f")"
done
```

### Run the pipeline

```bash
cd /opt/datasensAI/python
python3 pipeline.py ACME_                       # local output only (safe default)
python3 pipeline.py ACME_ --push-to-splunk      # also append to Splunk lookups (live dashboards)
python3 pipeline.py ACME_ -v                    # DEBUG logging
python3 pipeline.py ACME_ --input-dir input --output-dir output   # custom paths
```

The CLI exits non-zero on failure so cron/systemd see it. `--push-to-splunk` is **off by default** — it modifies live customer dashboards; enable only when intentional.

### Programmatic invocation (custom config)

```python
from config import PipelineConfig
from pipeline import run_pipeline

cfg = PipelineConfig(
    customer_token="ACME_",
    cost_per_gb_year=2500.0,            # customer's real license rate
    utilization_weight=0.30,            # weights MUST sum to 1.0
    detection_weight=0.45,
    quality_weight=0.25,
    detection_gap_technique_minimum=12, # broaden security-gap coverage
    push_to_splunk=False,
)
scored = run_pipeline(cfg)              # returns list[ScoredSourcetype]
```

### Generate the Executive Brief

```python
from pathlib import Path
from config import PipelineConfig
from pipeline import run_pipeline
from report_generator.generator import generate_report

cfg = PipelineConfig(customer_token="ACME_")
scored = run_pipeline(cfg)

generate_report(
    scored,
    "ACME Corporation",
    Path("output/ACME_/ACME_Executive_Brief"),
)
```

Writes `ACME_Executive_Brief.html` (and `.pdf` if WeasyPrint is installed). If PDF generation fails on macOS (gobject), open the HTML in Chrome → Print → Save as PDF.

The 9-page Brief includes: Exec Summary → Findings + SWOT → Engagement Goals + Strategic Recs (Ingest Actions, SmartStore, Edge Processor, Data Stewardship) → AI-Driven Use Case Recs (Suppress/Transform/Archive + Enrich/Index/Accelerate) → 5-Phase Roadmap → KPI Dashboard → Next Steps + Appendices → About bitsIO.

### Multi-customer

Just rerun with a different token; each run cleanly replaces that customer's rows in the Splunk lookups while preserving others:

```bash
python3 pipeline.py ACME_   --push-to-splunk
python3 pipeline.py GLOBEX_ --push-to-splunk
python3 pipeline.py INITECH_ --push-to-splunk
```

The dashboard **Customer** dropdown auto-populates.

### Refreshing MITRE / Lantern mappings (rare)

```bash
cd /opt/datasensAI/python

# MITRE (requires Splunk security_content clone):
cd /tmp && git clone --depth 1 https://github.com/splunk/security_content.git
cd /opt/datasensAI/python && python3 build_mitre_lookup.py

# Lantern (embedded knowledge base; preserves manual additions in the existing CSV):
python3 build_lantern_lookup.py
```

### View dashboards

In Splunk Web, navigate to the **datasensAI** app. No restart needed — dashboards read the lookups immediately.

| Dashboard | URL |
|---|---|
| Executive Overview | `/app/datasensAI/datasensai_v3_executive_dashboard` |
| Detail Analysis | `/app/datasensAI/datasensai_v3_detail_dashboard` |
| Storage Cost demo | `/app/datasensAI/datasensai_storage_cost_dashboard` |

Use the **Customer**, **Cost per GB/Year**, and three weight inputs to slice and rescore in real time without rerunning the pipeline.

---

## 11. Configuration Reference (`PipelineConfig` defaults)

| Setting | Default | Purpose |
|---|---|---|
| `customer_token` | `"default_customer"` | Prefix for input CSVs + output dir |
| `input_dir` / `output_dir` | `"input"` / `"output"` | Pipeline IO roots |
| `utilization_weight` / `detection_weight` / `quality_weight` | `0.35` / `0.40` / `0.25` | Must sum to 1.0 |
| `detection_potential_weight` / `detection_realized_weight` | `0.40` / `0.60` | Must sum to 1.0 |
| `utilization_multipliers` | `{alert:3, scheduled:3, dashboard:2, adhoc:1, user:2}` | KO weighting |
| `quality_scaling_factor` | `2000.0` | Quality penalty multiplier |
| `detection_technique_multiplier` | `1.25` | Scales MITRE count → 0–100 |
| `lantern_usecase_multiplier` | `6.0` | Scales Lantern count → 0–100 |
| `detection_gap_coverage_threshold` | `25.0` | % coverage below which security-gap fires |
| `detection_gap_technique_minimum` | `15` | Min techniques to even consider security-gap |
| `operational_gap_lantern_minimum` | `4` | Min Lantern use cases for operational-gap |
| `operational_gap_alert_maximum` | `0` | Max alerts for operational-gap to fire |
| `channel_based_sourcetypes` | `("XmlWinEventLog", "WinEventLog", "syslog")` | Split by channel when source has `:` |
| `tier1_threshold` / `tier2_threshold` / `tier3_threshold` | `65` / `40` / `20` | Composite cutoffs (must be strictly descending) |
| `cost_per_gb_year` | `3650.0` | Persisted annual_cost basis (dashboard input overrides at view time) |
| `splunk_home` / `splunk_app` | `"/opt/splunk"` / `"datasensAI"` | Push target |
| `push_to_splunk` | `False` | Live-dashboards switch; CLI flag `--push-to-splunk` enables |
| `backup_retention` | `5` | Timestamped backups of Splunk lookups before each push |

### Weight tuning by customer focus

| Customer focus | Util / Det / Qual |
|---|---|
| Security-first (SOC-driven) | 0.25 / 0.50 / 0.25 |
| Balanced (default) | 0.35 / 0.40 / 0.25 |
| Operations-first (IT Ops) | 0.50 / 0.25 / 0.25 |
| Data quality focus | 0.30 / 0.30 / 0.40 |

---

## 12. Worked Example — `o365:management:activity` (KH_ customer)

**Inputs:**
- 238 dashboard panels, 8 scheduled searches, 6 unique users, 0 explicit alerts
- MITRE technique_count: 65; Lantern usecase_count: low
- Quality issues: 0; daily_gb: 3.38

**Utilization:**
```
weighted_sum = (0×3) + (8×3) + (238×2) + (0×1) + (6×2) = 512
max_weighted_sum across customer = 512  (this IS the max)
utilization = (512 / 512) × 100 = 100.0
```

**Detection:**
```
mitre_potential   = min(100, 65 × 1.25) = 81.25
lantern_potential = small → ignored
potential         = max(81.25, ...) = 81.25
realized          = alerts come from security-named scheduled searches, normalized → ~77
detection        = 0.40 × 81.25 + 0.60 × 77.0 ≈ 78.7
```

**Quality:**
```
weighted_issues = 0 → quality = 100.0
```

**Composite + Tier:**
```
composite = 0.35×100 + 0.40×78.7 + 0.25×100 ≈ 91.5
91.5 ≥ 65 → Tier 1 (Critical)
```

**Annual cost:**
```
3.38 GB/day × $3,650/GB/year ≈ $12,337/year
```

**Detection gap?** No — coverage > threshold and alerts exist.

**Summary line for the customer:** *"o365:management:activity is your highest-value sourcetype — maximum utilization, strong MITRE-65 coverage with active detections, clean data. $12K/year is well justified."*

---

## 13. Dashboards — What Each Panel Means

### Executive Overview (board-ready, no drilldowns)
- **Methodology strip** — static color-coded explanation of the formula + tier thresholds.
- **ROI Score (donut)** — `avg(composite_score)` across all sourcetypes.
- **GainScope (donut)** — `(Tier 1+2 GB / total GB) × 100` — % of volume that's well-utilized.
- **Low-Value License Spend (donut, $/yr)** — `Σ(daily_gb × cost) for tier 3+4`.
- **Storage Savings Potential (donut, $/yr)** — `(excess_retention + unused_fields) × storage_$/GB/mo × 12`.
- **Portfolio totals** — total GB/day, total sourcetypes, total annual license.
- **Data Volume Split (pie)** — Utilized vs Under-utilized GB.
- **Sourcetype Split (pie)** — Utilized vs Under-utilized count (typically very different shape — long-tail).
- **Quick Wins** — top 3 actions with targets and estimated impact.
- **Tier Distribution (pie)** — sourcetype count per tier.
- **Score Profile by Tier (radar)** — avg Util / Det / Qual per tier (shows which dimension drags each tier).
- **Top 6 by Volume (radar)** — biggest sources on the same three axes ("are my biggest sources my best ones?").
- **Annual Spend by Tier (bar)** — where the license dollars go.
- **Savings Staircase (column)** — Current → After Ingest Actions → After Retention Tuning → After S3 → Optimized Target.
- **Util × Detection Quadrant (bubble)** — X=util, Y=det, size=daily_gb, color=tier. Top-right = gold; bottom-left = waste.
- **S3 / Federated Search Candidates** — tier 3/4 with specific archival rec per row.
- **Security Gaps (donut)** — count of `detection_gap == True`.
- **Operational Gaps (donut)** — count of `operational_gap == True`.
- **Detection Coverage by Domain (pie)** — MITRE categories + Lantern domains.
- **Trust Row (4 arc gauges)** — Resolution Confidence + portfolio means for Util / Det / Qual.
- **Full Scoring Table** — every sourcetype with everything.

### Detail Analysis (analyst drilldowns)
- **Mini KPI strip** — ROI Score + Resolution Confidence + Security Gaps (persistent context).
- **Status Board** — every sourcetype as a severity-colored tile. **Tile click → `selected_sourcetype` token**.
- **Scoring Detail Table** — parallel entry point; row click → same token.
- **Drilldown row (`$selected_sourcetype$`)** — KO count, searches using it, MITRE coverage, quality issues, Lantern use cases.
- **Field Usage Gap** — fields indexed vs used vs unused; row click → fields-to-keep / fields-to-drop.
- **MITRE Category pie + Security Gaps table** — slice pie filters the gap table.
- **Lantern Domain pie + Operational Gaps table** — mirror for non-security.
- **Unresolved Searches by Reason** — grouped + drilldown to SPL preview.
- **Retention Optimization** — per-index suggested retention with $/month and $/year savings.
- **Field-Level Storage Optimization** — explicit fields-to-KEEP and fields-to-DROP per sourcetype.
- **Under-Utilized + Use Case Lookup** — tier 3/4 enriched with Lantern counts so you don't blindly archive ("explore first" vs "route to S3").

---

## 14. Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| `ValueError: Invalid customer_token` | Token has spaces or special chars | Use alphanumeric/underscore/hyphen only |
| `ValueError: Scoring weights must sum to 1.0` | Custom weights drift | Verify `util + det + qual == 1.0` |
| `Pipeline input validation failed... Missing required CSVs` | Volume or inventory CSV missing | Re-run TA searches, copy with correct customer prefix |
| `Pipeline input validation failed... missing columns` | TA's CSV schema drifted | Update `_REQUIRED_COLUMNS` in `pipeline.py` to match |
| All composite scores `0` | Volume CSV has no data, or token doesn't match prefix | Inspect `python/input/`; confirm token includes trailing `_` |
| Detection scores all `0` | MITRE + Lantern CSVs missing | Rebuild via `build_mitre_lookup.py` / `build_lantern_lookup.py` |
| Low resolution rate (< 50%) | Macros / eventtypes / tags CSVs not populated | Re-run those TA reports; check for empty fields |
| `PermissionError: Cannot write to Splunk lookups dir` | Pipeline not running as splunk user | `chmod`/`chown` lookups dir or run as splunk |
| `ValueError: Path traversal detected` | CSV filename contains `..` or absolute path | Rename files |
| `Dimension 'X' is NaN/None — refusing to compute composite` | Upstream score produced NaN | Check the dimension's CSV inputs — usually empty / malformed |
| Dashboards say "No results" | `--push-to-splunk` was not set | Rerun with the flag; verify `datasensai_*.csv` exist in `lookups/` |
| PDF generation fails on macOS | WeasyPrint gobject mismatch | Use HTML → Chrome → Print to PDF, OR `brew install gobject-introspection glib pango` + symlinks |
| Critical tier empty | Likely on a very small / utilitarian environment | Lower `tier1_threshold` per customer, or accept it |
| `XmlWinEventLog` shows zero MITRE | Mapping is keyed on `WinEventLog:*` | Already handled — code retries with the `WinEventLog:` prefix |

---

## 15. Quick Reference — Customer One-Liners

| Metric | What to say |
|---|---|
| ROI Score | "On average your data delivers X% of its potential value" |
| GainScope | "X% of your daily volume is well-utilized" |
| Low-Value Spend | "You're paying ~$X/yr for data nobody is acting on" |
| Detection Gaps | "X sources have security potential but no active detections" |
| Operational Gaps | "X sources have IT-ops use cases but zero scheduled searches" |
| Tier 1 | "Mission-critical — keep it" |
| Tier 2 | "Good value — actively used or security-relevant" |
| Tier 3 | "Low utilization — review for optimization" |
| Tier 4 | "Minimal value — reduce volume or eliminate" |
| Resolution Confidence | "We confidently analyzed X% of your saved searches" |

---

## 16. Tests + Verification

```bash
cd /opt/datasensAI/python
python3 -m pytest tests/ -q          # full unit suite
python3 -m pytest tests/ -v -k score # just scoring
```

Verify a pipeline run by checking the summary block printed at the end:
```
=== Pipeline Summary for 'ACME_' ===
Total sourcetypes scored: 48
  Critical: 2
  Important: 3
  Nice-to-Have: 42
  Wasteful: 1
Detection gaps: 10
Results saved to: output/ACME_
```

Then spot-check `output/ACME_/ACME_scored_results.csv` — every row should have a non-null `composite_score`, `tier`, and `tier_label`. If any are blank, something silently failed upstream.

---

*Source of truth: `python/config.py`, `python/pipeline.py`, `python/scoring/*.py`. If this skill and the code disagree, the code wins — open `config.py` to verify current defaults before quoting numbers.*
