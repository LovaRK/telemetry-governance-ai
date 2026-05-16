# datasensAI Dashboard — TODO

## ✅ Done
- [x] Real Splunk integration (no mock data, REST API)
- [x] LLM pipeline — Ollama gemma4:e4b (local), Anthropic Claude (optional fallback)
- [x] PostgreSQL schema: telemetry_snapshots, executive_kpis, agent_decisions, search_audit
- [x] Connection gating — no dashboard without valid Splunk config + successful refresh
- [x] Refresh-only data fetch — dashboard never calls backend on load/tab switch
- [x] Expandable row reasoning in SourceIntelligenceGrid
- [x] Docker compose with health checks (postgres, ollama, web)
- [x] Search audit — orphan/unused saved searches classified and stored
- [x] Executive Overview — gauges, donut charts, scatter plot, savings staircase, quick wins
- [x] Detail page — KPI row, health board, retention table, security gaps, search audit tables
- [x] field_usage, security_coverage, quality_hotspots tables + API routes (return empty until populated)

## 🔄 In Progress
- [ ] Bootstrap script (`scripts/bootstrap.sh`) — one command to start full stack
- [ ] Universal `ReasoningDrawer` — clickable LLM reasoning on every gauge/chart/table
- [ ] `DecisionTimeline` activation on detail page (component exists, not wired)
- [ ] `SectionExplainer` banners — "How was this calculated?" on every section
- [ ] Trend sparklines on KPI cards (7-day history)
- [ ] `WhyThisWasShown` activation on AgentIntelligencePanel
- [ ] README.md with quick-start instructions

## 🔲 Backlog — Pipeline (requires new Splunk queries)
- [ ] Field usage analysis (Splunk tstats field-level query → field_usage table)
- [ ] MITRE ATT&CK security coverage mapping (sourcetype → technique → security_coverage)
- [ ] Data quality hotspots (parse error % per sourcetype → quality_hotspots)
- [ ] Duplicate collection detection (sourcetype overlap analysis)

## 🔲 Backlog — UI
- [ ] Line/trend charts (time-series ingest volume)
- [ ] Heat maps (field-level storage patterns)
- [ ] Sankey diagram (data flow from source to storage tier)
- [ ] User config panel (cost model, retention policy, decision weights)
- [ ] ConfigPanel UI with sliders for cost_per_gb_per_day

## 🔲 Backlog — Architecture
- [ ] user_config table (store user-configurable cost model / weights in DB)
- [ ] ConfigService (load/update cost model, retention policy from DB)
- [ ] Populate agent_decisions on every aggregation run (currently only telemetry_snapshots + executive_kpis written)
