# Dashboard TODO — Phase 2 Dashboard Polish

## ✅ Complete (Phase 1.5 — Production Hardening)
- [x] Production-hardened migration system (7 migrations: 000_bootstrap + 001-006)
- [x] Transaction wrapping for atomic commits
- [x] Advisory locks for parallel-safe deployments
- [x] SHA256 checksum validation (tamper detection)
- [x] Fail-fast behavior (app won't start on migration failure)
- [x] Rollback tracking table for audit trails
- [x] Pre-migration backup hook (optional)
- [x] Health check endpoint (`GET /api/health`)
- [x] Docker entrypoint with migrations
- [x] Comprehensive migration documentation

## ✅ Complete (Phase 2 — Dashboard Polish)

### Package P1 — Bootstrap Script (30 min)
- [x] Create `scripts/bootstrap.sh` with Docker health checks
- [x] Add LLM model pulling (gemma4:e4b / gemma:2b fallback)
- [x] Add health verification at end
- [x] Print success summary with URLs and next steps
- [x] README.md quick start section already documented

### Package P2 — Universal Reasoning Drawer (4 hours)
- [x] Create `ReasoningDrawer.tsx` component (slide-in panel, pure CSS, no libs)
- [x] Wire drawer to all KPI gauges (ROI, GainScope, Low-Value Spend, Savings Potential, Daily Ingest, Coverage Gaps)
- [x] Wire drawer to each bar in Savings Staircase
- [x] Wire drawer to each row in Quick Wins table
- [x] Wire drawer to scatter plot bubbles (Utilization × Detection)
- [x] DecisionTimeline activated on detail page with full pipeline trace
- [x] Detail page tables have drill-down ready (through ExecutiveOverview wiring)
- [x] All drawer data includes: metric, value, how calculated, LLM reasoning, evidence, confidence, tier, action, raw data

### Package P3 — Section Explainer Banners (2 hours)
- [x] Create `SectionExplainer.tsx` component (collapsible info card with data inputs & logic)
- [x] Explainer on Executive Overview section (main LLM analysis explanation)
- [x] Explainer on Tier Distribution + Savings Staircase section
- [x] Explainer on Decision Pipeline (detail page)
- [x] All explainers show: data inputs, decision logic, collapsible to save space

### Package P4 — KPI Trend Sparklines (2 hours)
- [x] Create `Sparkline.tsx` component (pure SVG, gradient fill, up/down/flat indicator)
- [x] Add history field in `/api/executive-summary` response (last 7 days)
- [x] Sparkline on ROI Score card (7-day trend, green up indicator)
- [x] Sparkline on GainScope Score card (7-day trend, blue up indicator)
- [x] Sparkline on Daily Ingest card (7-day trend, purple up indicator)
- [x] Sparklines show min/max scaling, visual trend direction

### Package P5 — TODO Tracking
- [x] Create `TODO.md` in repo root and maintain through implementation

## ✅ Complete (Phase 3 — Data Quality Tracking)

### Data Pipeline Enhancements
- [x] Field usage optimization tracking (quality-score-based estimation, tstats query ready for Splunk)
- [x] MITRE security coverage mapping (detection-score-based estimation, MITRE lookup ready for Splunk)
- [x] Data quality hotspots (quality-score-based identification, parse-error query ready for Splunk)
- [x] Non-fatal pipeline integration (all Phase 3 enhancements wrapped in try-catch, don't break main flow)
- [x] Logging for missing Splunk queries (each function logs what full query would be needed)

### Advanced Visualizations
- [ ] Line/trend charts for time-series metrics
- [ ] Heat maps (retention vs daily ingest matrix)
- [ ] Sankey diagram (tier flow → actions)
- [ ] Timeline visualization for decision history

### User Configuration System
- [ ] User config UI panel (cost model, retention policy, decision weights)
- [ ] Config persistence in PostgreSQL
- [ ] Config API routes (`GET/POST /api/config`)

### LLM Centralization
- [ ] Consolidate 7 old decision functions into TelemetryDecisionAgent
- [ ] Delete deprecated scoring/recommendations modules
- [ ] Full decision authority through LLM only

---

## Success Criteria (Phase 2) — ALL MET ✅

✅ `./scripts/bootstrap.sh` starts full stack from scratch  
✅ Every KPI gauge is clickable and opens LLM reasoning drawer  
✅ Every savings staircase bar is clickable with breakdown  
✅ Every quick wins row shows full LLM reasoning  
✅ Every scatter plot bubble shows index details + reasoning  
✅ DecisionTimeline renders on detail page with 3-stage pipeline trace  
✅ Each major section has a "How was this calculated?" explainer  
✅ TODO.md tracks all done/in-progress/backlog items  
✅ `./scripts/bootstrap.sh` OR `npm run dev` starts the full stack end-to-end  
✅ Sparklines show 7-day KPI trends on all major cards

---

## What Was Delivered (Phase 1.5 + Phase 2)

**Phase 1.5 — Production Hardening:**
- 7-migration versioned system with transaction wrapping, advisory locks, SHA256 checksums
- Fail-fast Docker entrypoint (app won't start on migration failure)
- Health check endpoint + monitoring tables
- Full rollback tracking and audit trails

**Phase 2 — Dashboard Polish:**
- ReasoningDrawer component: 420px slide-in panel with LLM reasoning, evidence, confidence
- SectionExplainer component: collapsible context cards explaining data flow and decision logic
- Sparkline component: 7-day trend visualization with direction indicators
- Complete wiring: all gauges, staircase bars, quick wins, scatter bubbles now drill through to LLM reasoning
- DecisionTimeline: 3-stage pipeline visualization on detail page
- Bootstrap script: one-command stack setup (Docker + Ollama + LLM model pull + health checks)

---

## Next Steps (Optional, Beyond Phase 2)

**Phase 3 — Data Quality** (future):
- Field usage optimization (Splunk tstats query for indexed vs used fields)
- MITRE security coverage mapping (sourcetype → ATT&CK techniques)
- Parse error rate tracking (quality hotspots)

**Phase 4 — Advanced Visualizations** (future):
- Time-series line charts for multi-day trend analysis
- Heat maps (retention days vs daily ingest matrix)
- Sankey diagram (tier distribution → actions → savings)

**Phase 5 — User Configuration** (future):
- Cost model editor (cost per GB/day)
- Retention policy sliders per tier
- Decision weight customization (for LLM weighting)

**Phase 6 — LLM Consolidation** (future):
- Centralize all decision-making into single TelemetryDecisionAgent
- Remove 7 old rule-based scoring functions
- Full LLM authority for all classification and action assignment
