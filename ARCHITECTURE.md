# Agentic Telemetry Operating System — Architecture & Design

**Last Updated:** 2026-05-16  
**Status:** Production-Ready (All 10 Phases Complete)  
**System Type:** LLM-Driven Decision Engine with Audit Trail

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Data Flow Pipeline](#data-flow-pipeline)
4. [Database Schema](#database-schema)
5. [LLM Decision Engine](#llm-decision-engine)
6. [Frontend Architecture](#frontend-architecture)
7. [User Configuration System](#user-configuration-system)
8. [Audit Trail & Decision History](#audit-trail--decision-history)
9. [Bulk Operations](#bulk-operations)
10. [Deployment & Operations](#deployment--operations)
11. [Performance & Scalability](#performance--scalability)
12. [Security Model](#security-model)

---

## Executive Summary

The Agentic Telemetry Operating System is a LLM-powered dashboard for Splunk index optimization. It replaces hardcoded scoring rules with a **single source of truth**: an LLM decision agent (gemma4:e4b via Ollama) that evaluates all telemetry data and assigns tier/action recommendations to Splunk indexes.

**Core Principles:**
- **Single Authority:** All decisions come from LLM, never from Python rules or hardcoded heuristics
- **Data Normalization Only:** Python fetches & normalizes Splunk data; doesn't score
- **User-Configurable:** Cost models, retention policies, and decision weights stored in PostgreSQL
- **Audit Trail:** Every decision change is recorded with reason and evidence
- **Non-Fatal Pipeline:** Failures logged but don't break main flow (graceful degradation)
- **Pure Frontend:** SVG/CSS visualization, no external UI libraries

---

## System Architecture

### Component Layers

```
┌─────────────────────────────────────────────────────────┐
│           Frontend (Next.js + React)                    │
│  - Dashboard with 4 visualization tabs                  │
│  - Bulk actions modal for multi-index operations        │
│  - Decision history viewer                              │
│  - Reasoning drawers for drill-down                     │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│      Backend API Routes (Next.js)                       │
│  - /api/executive-summary (KPIs + sparklines)           │
│  - /api/agent-decisions (decision detail table)         │
│  - /api/config (user settings)                          │
│  - /api/decision-history (audit trail)                  │
│  - /api/bulk-actions (multi-index operations)           │
│  - /api/cache-status (refresh trigger)                  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│       Service Layer (TypeScript)                        │
│  - TelemetryDecisionAgent (LLM orchestration)           │
│  - ConfigService (user settings persistence)           │
│  - DecisionHistoryService (audit log management)        │
│  - BulkActionsService (multi-index operations)          │
│  - AggregationService (Splunk fetch + orchestration)    │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│         External Systems                                │
│  - PostgreSQL 14+ (decisions, history, config)          │
│  - Ollama (gemma4:e4b LLM inference)                    │
│  - Splunk API (index metrics, saved searches)           │
└─────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14, React 18, TypeScript | Dashboard UI with SSR |
| Backend | Node.js, Express/Next API | Decision routing & API |
| Database | PostgreSQL 14+ | Telemetry snapshots, decisions, audit |
| LLM | Ollama (gemma4:e4b) + Anthropic fallback | Decision intelligence |
| Visualization | SVG (pure), CSS Grid | Charts, gauges, Sankey |
| Build | Turbo, tsx, esbuild | Monorepo optimization |

---

## Data Flow Pipeline

### 4-Stage Execution Model

```
STAGE 1: Fetch Raw Data from Splunk
    └─ AggregationService.fetchTelemetry()
    └─ Queries: indexMetrics, sourcetypeMetrics, savedSearches
    └─ Output: RawTelemetryInput[] (no scoring)

STAGE 2: Normalize & Prepare
    └─ AggregationService.normalizeTelemetry()
    └─ No pre-scoring; only data extraction
    └─ Fields: dailyAvgGb, totalEvents, retentionDays, etc.
    └─ Output: RawTelemetryInput[] ready for LLM

STAGE 3: LLM Decision Agent
    └─ TelemetryDecisionAgent.runLLMDecisionAgent()
    └─ Batches 5 indexes per prompt
    └─ Calls gemma4:e4b via Ollama (with Anthropic fallback)
    └─ LLM scores: utilization, detection, quality, risk (0-100 each)
    └─ LLM assigns: tier, action, confidence, reasoning
    └─ Output: LLMDecision[] with full justification

STAGE 4: Persist to PostgreSQL
    └─ INSERT INTO telemetry_snapshots (summary stats)
    └─ INSERT INTO executive_kpis (ROI, GainScope, savings)
    └─ INSERT INTO agent_decisions (tier, action, scores, reasoning)
    └─ INSERT INTO decision_history (tier/action changes)
    └─ INSERT INTO search_audit (orphan/unused searches)
    └─ Output: Snapshot ID for UI queries
```

### Execution Timeline

- T+0s: Fetch Splunk (parallel, max 2 concurrent)
- T+2-5s: Normalize (Python or TypeScript, ~1KB per index)
- T+5s: Load user config
- T+6-30s: LLM batch processing (Ollama via HTTP)
- T+30-35s: Persist to PostgreSQL
- T+35s+: Frontend refetch

---

## Database Schema Overview

### Core Tables
- **telemetry_snapshots** — Root record for each snapshot run
- **executive_kpis** — Aggregated metrics (tier/action counts, savings)
- **agent_decisions** — Per-index decisions from LLM (scores, reasoning, evidence)
- **decision_history** — Audit trail of tier/action changes
- **user_config** — User-configurable parameters (cost model, retention policy)
- **config_audit_log** — History of config changes with old/new JSONB values
- **llm_prompt_versions** — Version control for LLM prompts

### Secondary Tables (With Fallback Empty Data)
- **field_usage** — Per-sourcetype field analysis (indexed vs used fields)
- **security_coverage** — MITRE technique mapping per sourcetype
- **quality_hotspots** — Data quality metrics (parse error %, validation failures)
- **search_audit** — Orphan/unused saved searches

All tables use TIMESTAMPTZ for UTC timestamps, foreign key constraints for referential integrity, and strategic indexes on snapshot_date, index_name, action for fast queries.

---

## LLM Decision Engine

### TelemetryDecisionAgent Architecture

**Core Functions:**

1. **buildDecisionPrompt(inputs, userConfig, costModel)**
   - Formats Splunk data + user config into structured LLM prompt
   - Requests LLM to score 4 dimensions (0-100): utilization, detection, quality, risk
   - Requests tier assignment based on scores
   - Requests action (KEEP/OPTIMIZE/ARCHIVE/ELIMINATE/S3_CANDIDATE)
   - Requests confidence (0-1) and reasoning with evidence array

2. **parseDecisionOutput(llmText)**
   - Extracts structured JSON from LLM response (may have preamble)
   - Validates keys present: decisions array required
   - Returns typed LLMDecision[] + KPI summary

3. **validateDecision(decision)**
   - Type-checks: index, tier, action, scores (all 0-100), confidence (0-1)
   - Returns { valid, error } tuple
   - Invalid decisions are skipped, logged, processing continues

4. **runLLMDecisionAgent(inputs, userConfig, costModel, maxParallel=2)**
   - Batches inputs into chunks of 5 (optimized for Ollama token limits)
   - Processes batches sequentially (respecting maxParallel=2)
   - For each batch: calls buildDecisionPrompt → POST to Ollama → parseDecisionOutput → validate
   - Timeout: 30s per batch, retry 2x on timeout, then skip batch
   - Calculates aggregate KPIs after all batches
   - Returns AgentSummary with decisions + KPIs + execution stats

### Ollama Integration

**HTTP Request to gemma4:e4b:**
```
POST http://localhost:11434/api/generate
{
  "model": "gemma4:e4b",
  "prompt": "[formatted prompt with 5 indexes]",
  "stream": false,
  "timeout": 30000,
  "temperature": 0.3
}
```

**Anthropic Fallback:**
If Ollama unavailable after 2 retries, fallback to Claude Opus via API

### Decision Scoring Logic

LLM assigns scores 0-100 for:

1. **Utilization Score** — Is this index actively used?
2. **Detection Score** — Does sourcetype contribute to threat detection?
3. **Quality Score** — Is data reliable and well-structured?
4. **Risk Score** — What's the risk of removing this index?

**Tier Assignment:**
- CRITICAL: utilization + detection > 150 OR risk > 70
- IMPORTANT: composite > 65 AND retention > 365 days
- NICE_TO_HAVE: composite 40-65
- LOW_VALUE: composite < 40 AND retention < 90 days

**Action Assignment:**
- KEEP: tier in [CRITICAL, IMPORTANT]
- OPTIMIZE: tier=NICE_TO_HAVE AND dailyAvgGb > 10
- ARCHIVE: tier=LOW_VALUE AND retention > 180 AND lastEvent < 30 days
- ELIMINATE: tier=LOW_VALUE AND dailyAvgGb < 1
- S3_CANDIDATE: detection < 40 AND dailyAvgGb > 50 AND retention > 365 days

---

## Frontend Architecture

### Component Hierarchy

**Dashboard (ExecutiveOverview.tsx):**
- 4-Tab Interface: Summary | Trends | HeatMap | Flows
- Summary tab: KPI gauges, quick wins table, savings staircase
- Trends tab: 7-day ROI/GainScope with date filtering
- HeatMap tab: Retention × Ingest matrix with click drill-down
- Flows tab: Tier → Action → Savings Sankey diagram

**Detail Page (detail/page.tsx):**
- 9 detail tables: Security Gaps, Quality Hotspots, Retention, etc.
- Decision Timeline showing change history
- ReasoningDrawer integration on all table rows

**Visualization Components:**
- **LineChart.tsx** — 7-day trend with date range filtering
- **HeatMapInteractive.tsx** — Drill-down matrix by retention × ingest zone
- **Sankey.tsx** — Flow diagram with click highlighting
- **DecisionTimeline.tsx** — Timeline of decision changes
- **ReasoningDrawer.tsx** — Universal drill-down panel (420px slide-in from right)

All components use pure SVG or CSS Grid, no external UI libraries.

---

## User Configuration System

### ConfigService

**Functions:**
- loadUserConfig() — Fetch from DB with fallback defaults
- updateCostModel(costPerGb) — Persist user cost input
- updateRetentionPolicy(policyMap) — Persist retention overrides
- updateDecisionWeights(weights) — Persist optional LLM prompt tweaks

### ConfigPanel Component

- Cost model slider: $0.10–$2.00 per GB/day (default $0.50)
- Retention policy inputs: tier → max days
- Decision weights (optional): fine-tune LLM scoring
- "Last updated: X hours ago" indicator

### API Route (/api/config)

- GET: Returns current UserConfig
- POST: Validates & updates config, records change in config_audit_log

---

## Audit Trail & Decision History

### DecisionHistoryService

**Functions:**
- recordDecisionChange(record) — INSERT into decision_history
- recordConfigChange(audit) — INSERT into config_audit_log
- getDecisionHistory(indexName?, limit, offset) — Paginated query
- getConfigAuditTrail(limit, offset) — Paginated audit log
- getCurrentLLMPromptVersion() — Get active prompt
- recordLLMPromptChange(template, modelName, notes) — Version new prompt

### DecisionHistoryViewer Component

- Tab interface: "Decision Changes" vs "Config Changes"
- Timeline view: newest first
- Decision cards: index, date, tier/action transitions, score delta
- Config cards: change type, old/new values, user attribution
- Color-coded badges for tier/action transitions

---

## Bulk Operations

### BulkActionsService

**Functions:**
- applyBulkAction(request) — UPDATE indexes with audit trail
- getBulkActionPreview(indexNames, action) — Show impact without committing
- exportBulkRecommendations(indexNames, format) — Download as JSON/CSV

### BulkActionsModal Component

- Displays selected indexes (max 20 visible, "+N more" if >20)
- Action selector grid: 5 options with color codes
- Optional reason textarea for audit trail
- Apply button: disabled during loading, shows "Applying..."
- Per-index success/failure feedback

---

## Deployment & Operations

### Docker Compose Stack

**Services:**
- postgres:14 (Database, healthcheck: pg_isready)
- ollama:latest (LLM inference, healthcheck: ollama list)
- web:latest (Next.js dashboard, healthcheck: curl /api/cache-status)

### Bootstrap Script (scripts/bootstrap.sh)

1. Check Docker daemon
2. Pull images
3. Start postgres + wait
4. Start ollama + wait
5. Pull gemma model
6. Start web + wait
7. Print success with localhost:3002

### Environment Variables

```
DATABASE_URL=postgresql://...
OLLAMA_BASE_URL=http://localhost:11434
SPLUNK_HOST/PORT/USERNAME/PASSWORD or AUTH_TOKEN
ANTHROPIC_API_KEY=... (fallback only)
```

### Database Migrations

7 migration files in infrastructure/migrations/
- 001_initial_schema.sql
- 002_user_config.sql
- 003_decision_history.sql
- 004_search_audit.sql
- 005_field_usage.sql
- 006_security_coverage.sql
- 007_quality_hotspots.sql

---

## Performance & Scalability

### Optimization Techniques

- Batch processing: 5 indexes per LLM prompt
- Sequential batching: MAX_PARALLEL=2 (Ollama constraint)
- Database indexing: snapshot_date, index_name, action
- Caching: Executive summary cached 5 minutes
- Pagination: Detail tables (50 items per page)
- Pure SVG rendering: No re-render on zoom/pan

### Scalability Limits

| Metric | Limit | Notes |
|--------|-------|-------|
| Indexes per snapshot | 10,000+ | Batched in groups of 5 |
| Decision history | 100,000+ | Pruned if >90 days |
| LLM inference time | 30s/batch | Timeout + retry 2x |
| Dashboard load time | <3s | Cached |
| Detail page render | <2s | Paginated |

### Monitoring

Log: aggregation-service, telemetry-decision-agent timing and errors
Metrics: LLM inference time (target 4-6s/batch), batch timeout rate (<1%), validation failure rate (<0.1%)
Alerting: Ollama unavailable → fallback to Anthropic; timeouts/failures are non-fatal

---

## Security Model

### Authentication & Authorization

- Environment-based: Splunk creds, DB connection, API keys injected at runtime
- Network isolation: PostgreSQL and Ollama on Docker internal network
- HTTPS: Enforced in production via reverse proxy

### Data Governance

- Audit trail: Every decision change logged with reason
- Compliance: No PII stored, only indexes/sourcetypes
- Secrets: Never logged, only in memory
- Retention: Snapshots pruned after 90 days automatically

---

## Operational Checklist

**Dashboard loads forever:**
- Check Splunk: curl -k https://splunk:8089/services/appserver/info
- Check DB: psql -c "SELECT 1 FROM telemetry_snapshots LIMIT 1"
- Check Ollama: curl http://localhost:11434/api/tags
- Check logs: docker logs web

**LLM decisions look wrong:**
- Check prompt version: SELECT from llm_prompt_versions
- Review evidence: expand ReasoningDrawer
- Check Ollama logs: docker logs ollama

**Old data not pruned:**
- Manual cleanup: DELETE FROM telemetry_snapshots WHERE snapshot_date < NOW() - INTERVAL '90 days'

---

**Document Version:** 1.0  
**Last Reviewed:** 2026-05-16  
**Status:** Complete (All 10 Phases Implemented)
