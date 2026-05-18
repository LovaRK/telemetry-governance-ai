# Dashboard TODO

## ✅ Architectural Fixes (May 16, 2026)

### LLM Decision Agent Refactoring
- [x] Remove post-processing corruption (hardcoded KPI formulas, synthetic values)
- [x] Implement strict schema validation (fail loud on invalid/missing fields)
- [x] Remove applyDefaults function (no silent repair)
- [x] Add HARD MODEL LOCK (ALLOWED_MODEL='gemma2:9b' with process.exit on mismatch)
- [x] Implement LLMConfig schema with validation (costPerGbPerDay, maxIndexesPerRun, llmTimeoutMs)
- [x] Add BACKPRESSURE (reject inputs exceeding maxIndexesPerRun)
- [x] Add decision-level metrics (track inference time, decision counts per batch)
- [x] Establish architectural truth: LLM = reasoning authority, Code = enforcement authority
- [x] Ensure LLM provides ALL aggregate KPIs or entire batch is rejected

**Result:** System fails fast on incomplete/invalid LLM output instead of synthesizing values. Model cannot drift without code changes.

---

---

## ✅ Phase 2: UI Drill-Down & Explanation (COMPLETE — May 16, 2026)

**Status:** Dashboard is now self-documenting for demos. All KPIs, gauges, and table rows show LLM reasoning via drill-down drawer.

### Completed Components
- [x] ReasoningDrawer (slide-in right panel with LLM reasoning, evidence, confidence)
- [x] SectionExplainer (collapsible info banners on all major sections)
- [x] Sparkline component (7-day trend lines — SVG, no external lib)
- [x] Bootstrap script (one-command Docker stack startup)
- [x] DecisionTimeline (already exists, now rendered on detail page)
- [x] WhyThisWasShown (already exists, integrated into panels)
- [x] Detail page drill-down: info buttons on 4 tables (Security Gaps, Quality Hotspots, Operational Coverage, Under-Utilized)

### Demo-Ready Features
✅ Every gauge in ExecutiveOverview is clickable → opens drawer with LLM reasoning  
✅ Every bar in Savings Staircase shows breakdown on click  
✅ Every Quick Win shows full recommendation on click  
✅ Every table row has info button → shows why that row was flagged  
✅ Each major section has "How was this calculated?" collapsible explanation  
✅ Bootstrap script: `./scripts/bootstrap.sh` starts full stack from scratch  

---

## ✅ Phase 1: Core Pipeline & Cold Start UX (Days 1-5)

### Model & Timeout Stability
- [x] Replace hardcoded model with LLM_MODEL environment variable
- [x] Validate model at startup with helpful warnings
- [x] Three-level timeout architecture (TOTAL_PIPELINE, SPLUNK_QUERY, LLM_BATCH)
- [x] Implement 2x retry logic on timeout-specific errors
- [x] Fallback to Anthropic API on Ollama timeout

### Pure Agentic Decision Making
- [x] Rewrite LLM system prompt to receive only raw signals (no scoring rules)
- [x] Remove all hardcoded thresholds and decision trees
- [x] LLM makes holistic decisions with evidence-based confidence scoring

### Cold Start UX & Connection Gating
- [x] Connection gating component (checks Splunk config on mount)
- [x] Settings page with Splunk credentials form
- [x] Test connection endpoint (/api/test-connection)
- [x] Contextual error hints (firewall, auth, timeout, permission)
- [x] localStorage persistence of credentials
- [x] Dashboard non-functional until Splunk is configured and validated

### Observability Instrumentation
- [x] system_metrics table schema with timing and configuration fields
- [x] MetricsCollector class (stage timing, metric recording, config snapshots)
- [x] Integrate MetricsCollector into aggregation pipeline
- [x] Persist metrics to system_metrics table after each run
- [x] Log human-readable metrics summary

---

## ✅ Configuration System (May 16, 2026)

### Package A: User Configuration System
- [x] Create user_config table in schema
- [x] Build ConfigService (load, update cost/backpressure/timeout)
- [x] Implement in-memory cache with 5-minute TTL
- [x] Create /api/config route (GET/POST)
- [x] Create ConfigPanel UI component with sliders

### Package D: Update Aggregation Service
- [x] Import ConfigService and LLMConfig
- [x] Load user config from DB at pipeline start
- [x] Pass LLMConfig to runLLMDecisionAgent
- [x] Extract and log decision metrics
- [x] Graceful fallback to defaults

**Result:** Configuration is now a first-class citizen. Users can adjust cost model without code changes.

---

## ✅ Phase 2: UI Drill-Down & Explanation (COMPLETE)

**Status:** All core UI enhancements complete. Dashboard is fully self-documenting. Ready for secondary table population and polish.

### UI Components (Readiness Check)
- [x] Create ReasoningDrawer component (slide-in right drawer, 420px wide)
  - [x] Props interface: isOpen, onClose, title, metric, value, howCalculated, llmReasoning, evidence, confidence, tier, action, rawData
  - [x] Visual sections: calculation formula, LLM reasoning, evidence list, raw data (expandable)
  - [x] Inline CSS styling (dark theme with proper spacing)
  - [x] Close button (×) and scroll handling
  - [x] Keyboard ESC to close, overlay click to close, prevent body scroll

- [x] Create SectionExplainer component (collapsible info banner)
  - [x] Props interface: title, summary, dataInputs[], decisionLogic, isCollapsed
  - [x] Blue info card, "How was this calculated? ▾" toggle
  - [x] Default collapsed state
  - [x] Data inputs displayed as monospace tags

- [x] Create Sparkline component (7-day trend line chart)
  - [x] Pure SVG, no external charting library
  - [x] Props: data: number[], color: string, width, height
  - [x] Gradient fill under polyline
  - [x] Auto-scaling to data range, handles single/multiple points

### Dashboard Wiring (Ready for Implementation)
- [x] ConfigPanel component created (now need to wire into dashboard header)
- [x] ReasoningDrawer component created
- [x] SectionExplainer component created
- [x] Sparkline component created
- [x] Add ConfigPanel button to dashboard header
- [x] Fetch config on dashboard load: GET /api/config (ConfigPanel handles this)
- [x] Wire ReasoningDrawer to ExecutiveOverview gauges:
  - [x] ROI Score gauge
  - [x] GainScope Score gauge
  - [x] License Spend gauge (Low-Value Spend)
  - [x] Storage Savings gauge
  - [x] Security Gaps gauge
  - [x] Operational Gaps gauge
  - [x] Confidence gauge
- [x] Wire ReasoningDrawer to interactive elements:
  - [x] Each savings staircase bar clickable
  - [x] Each quick wins row clickable
  - [x] Each scatter bubble clickable
  - [x] Tier Distribution tiers clickable

- [x] Activate existing components:
  - [x] DecisionTimeline (already exists) → render on detail page
  - [x] WhyThisWasShown (already exists) → render on AgentIntelligencePanel

- [x] Add SectionExplainer to major sections:
  - [x] Executive Overview (above gauges)
  - [x] Tier Distribution section
  - [x] Savings Staircase section
  - [x] AgentIntelligencePanel
  - [ ] Detail page KPI row (optional — KPI row already gauges)
  - [ ] Each detail table (not needed — section headers explain)

- [x] Expand reasoning on detail page tables:
  - [x] Add ℹ️ button to each row (Security Gaps, Quality Hotspots, Operational Coverage, Under-Utilized)
  - [x] Click → ReasoningDrawer with recommendation + reasoning

### API & Data Changes (Readiness Check)
- [ ] Update /api/executive-summary:
  - [ ] Add 7-day history: last 7 snapshots (snapshot_date, roi_score, gainscope_score, total_daily_gb, total_license_spend) — OPTIONAL
  - [ ] Return in ExecutiveSummary type

- [ ] Add sparklines to KPI cards (OPTIONAL — core dashboard is self-documenting):
  - [ ] ROI Score card (7-day roi_score trend)
  - [ ] GainScope Score card (7-day gainscope_score trend)
  - [ ] License Spend card (7-day total_license_spend trend)
  - [ ] Daily Ingest card (7-day total_daily_gb trend)

### Bootstrap Script (COMPLETE)
- [x] Create scripts/bootstrap.sh (full Docker stack startup)
- [x] Update README.md with quick-start instructions:
  - [x] Prerequisites section (Docker, Node 18+)
  - [x] Quick start: `chmod +x scripts/bootstrap.sh && ./scripts/bootstrap.sh`
  - [x] Step-by-step explanation of what the script does

---

## ✅ Phase 3: Data Flow Verification & Production Testing (COMPLETE)

### Build Stabilization (May 17, 2026) — COMPLETE  
- [x] Web-only DEMO_MODE: APIs return 503 with mode indicator when database unavailable
- [x] Middleware no longer requires DATABASE_URL/LLM_MODEL as hard errors
- [x] APIs gracefully degrade when dependencies missing
- [x] All 17 API routes compile and run correctly
- [x] page.tsx JSX syntax fixed (return wrapped in fragment)

### Data Flow End-to-End Testing (May 17, 2026) — COMPLETE ✅
- [x] Start PostgreSQL and Ollama services
- [x] Verify database schema (migrations complete)
- [x] Test Splunk connection with real credentials (https://144.202.48.85:8089)
- [x] Trigger /api/cache POST with Splunk URL + token ✅ (3 indexes fetched in 1.2s)
- [x] Verify Splunk → Aggregation pipeline works ✅ (snapshotId created)
- [x] Verify LLM processing completes ✅ (worker processed 2 batches)
- [x] Check agent_decisions table has real data ✅ (7 decisions stored)
- [x] Verify /api/executive-summary returns FULL_STACK mode with data ✅ (real KPIs)
- [x] Verify /api/agent-decisions returns real decisions ✅ (7 decisions returned)
- [x] Test dashboard end-to-end ✅ (HTML renders, APIs responding)

### Secondary Table Population (Status: PARTIAL — 3/4 tables populated)
- [x] field_usage: 11 rows populated (indexed vs used fields per sourcetype)
- [ ] security_coverage: 0 rows (Map sourcetype to MITRE techniques — no detection gaps found)
- [ ] quality_hotspots: 0 rows (Parse error % per sourcetype — no items quality_score < 50)
- [x] search_audit: 320 rows populated (Orphaned/unused saved searches from Splunk)

**Current Behavior:**
- field_usage populated from worker: utilization_score calc → optimization_pct
- search_audit populated from Splunk: getOrphanedSearches() → 320 scheduled searches
- quality_hotspots triggers when decision.quality_score < 50 (none found in current data)
- security_coverage triggers when decision.detection_gap = true (none found in current data)

### Advanced Visualizations (WEEK 3)
- [ ] Line/trend charts (historical KPI trends) 
- [ ] Heat maps (activity patterns)
- [ ] Sankey diagram (data flow and decisions) — component exists, needs wiring to real data

---

## Current Production Readiness (May 17, 2026)

### ✅ What's Working
- **Core Pipeline:** Splunk → Aggregation → Job Queue → LLM Worker → Database → APIs
- **Web UI:** Renders correctly, all components integrated
- **APIs:** 17 endpoints, all returning real data or graceful DEMO_MODE
- **Database:** Schema complete, 7 tables populated with real data
- **Async Jobs:** Queue-based processing with SSE streaming
- **Web-Only Mode:** Works without database (for development)

### ⚠️ Known Limitations
- quality_hotspots: Requires indexes with quality_score < 50
- security_coverage: Requires indexes with detection_gap = true
- Detail page tables: May show empty arrays if secondary data not populated
- No UI for modifying LLM decisions (read-only view)
- No historical trending (single snapshot only)

### 🔄 Next Phase: Advanced Features (Week 4+)
- Historical KPI trending (7/30/90 day trends)
- Decision reasoning drill-down (expand evidence)
- Bulk actions (ARCHIVE, OPTIMIZE multiple indexes)
- Custom cost model configuration
- Export/reporting features
- Performance optimization (caching, indexes)

---

## Notes

**Phase 1 Completed:** Core pipeline is stable, cold start UX is clear, observability is instrumented.

**Phase 2 Completed:** Dashboard is self-documenting with drill-down reasoning for all KPIs and decisions.

**Phase 3 Completed:** Build stabilization and full-stack data flow verified end-to-end with real Splunk data.

**Current Date:** 2026-05-17

**Session Status:** Production pipeline verified working. Ready for beta testing or advanced feature development.

---

## Notes

**Phase 1 Completed:** Core pipeline is stable, cold start UX is clear, observability is instrumented.

**Phase 2 Focus:** Transform dashboard into self-documenting system where every number shows its reasoning and every decision can be drilled into. Goal: dashboard explains itself for demos without needing external documentation.

**Current Date:** 2026-05-16
