## Jira Epic: AETHERIS-2026 — Production Agentic Telemetry OS

### 🔴 Infrastructure (Priority 1)
- [x] AETHERIS-101: Create PostgreSQL schema (`telemetry_snapshots`, `cache_metadata`, `decision_traces`, `refresh_jobs`)
- [x] AETHERIS-102: Update `docker-compose.yml` with PostgreSQL service + healthchecks + volumes
- [x] AETHERIS-103: Build `core/database/connection.ts` with pool, transactions, health check
- [x] AETHERIS-104: Add `pg` dependency to `apps/web/package.json` and `core/package.json`
- [x] AETHERIS-105: Add unique constraint `idx_snapshots_unique` to schema for upsert operations

### 🟠 Backend Core Services (Priority 2)
- [x] AETHERIS-201: Build `splunk-client.ts` (MCP-ready placeholder with health check)
- [x] AETHERIS-202: Build `aggregation-service.ts` (incremental refresh, delta window)
- [x] AETHERIS-203: Build `scoring-service.ts` (deterministic rules, confidence engine, batch scoring)
- [x] AETHERIS-204: Build `cache-service.ts` (staleness tracking, metadata CRUD)
- [x] AETHERIS-205: Build `telemetry-repository.ts` (snapshot CRUD, KPI metrics, value/waste matrix)
- [x] AETHERIS-206: Build `trace-repository.ts` (decision trace persistence, audit queries)

### 🟡 6-Agent Pipeline (Priority 3)
- [x] AETHERIS-301: Discovery Agent (index enumeration, MCP health validation)
- [x] AETHERIS-302: Normalization Agent (raw → structured, daily avg calculation)
- [x] AETHERIS-303: Scoring Agent (deterministic classification, evidence collection)
- [x] AETHERIS-304: Reasoning Agent (LLM insight generation with fallback)
- [x] AETHERIS-305: Decision Agent (recommendation ranking, confidence aggregation)
- [x] AETHERIS-306: Audit Agent (compliance checks, coverage validation, final report)

### 🟢 API Layer (Priority 4)
- [x] AETHERIS-401: Build `/api/telemetry` route (GET with filters, KPI aggregation)
- [x] AETHERIS-402: Build `/api/cache` route (GET status, POST manual refresh)
- [x] AETHERIS-403: Update `/api/pipeline` route (cache-first logic, demo mode passthrough)

### 🔵 Frontend Dashboards (Priority 5)
- [x] AETHERIS-501: Build `ExecutiveOverview.tsx` (KPI cards, scenario badge)
- [x] AETHERIS-502: Build `ValueWasteMatrix.tsx` (ScatterChart, classification colors, tooltips)
- [x] AETHERIS-503: Build `SourceIntelligenceGrid.tsx` (sortable table, filter, confidence bars)
- [x] AETHERIS-504: Build `DecisionTimeline.tsx` (expandable stages, confidence bars, evidence)
- [x] AETHERIS-505: Build `TopAppBar.tsx` (cache status indicator, refresh button)
- [x] AETHERIS-506: Update `page.tsx` to use new dashboard components + cache status + refresh handler

### 🟣 Scheduled Jobs (Priority 6)
- [ ] AETHERIS-601: Build `scheduled-refresh.ts` cron job (every 6 hours)
- [ ] AETHERIS-602: Add job logging to `refresh_jobs` table
- [ ] AETHERIS-603: Implement auto-stale detection + trigger

### ⚪ Tests & QA (Priority 7)
- [x] AETHERIS-701: Unit tests for `scoring-service.ts` (deterministic classification)
- [x] AETHERIS-702: Integration test for 6-agent pipeline end-to-end
- [ ] AETHERIS-703: Add repository tests with testcontainers PostgreSQL
- [ ] AETHERIS-704: Add API route tests (Supertest + Next.js)

### 🔘 Documentation (Priority 8)
- [ ] AETHERIS-801: Update `AGENTS.md` with new architecture and file paths
- [ ] AETHERIS-802: Document deterministic scoring rules
- [ ] AETHERIS-803: Add Docker setup instructions for PostgreSQL