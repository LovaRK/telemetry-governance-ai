# Agentic Telemetry Operating System — Architecture & Design

**Last Updated:** 2026-05-16  
**Status:** Production-Ready (All 10 Phases Complete)  
**System Type:** LLM-Driven Decision Engine with Audit Trail

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architectural Tradeoffs & Risk Model](#architectural-tradeoffs--risk-model)
3. [Known Constraints & Limitations](#known-constraints--limitations)
4. [System Architecture](#system-architecture)
5. [Data Flow Pipeline](#data-flow-pipeline)
6. [Database Schema](#database-schema)
7. [LLM Decision Engine](#llm-decision-engine)
8. [Frontend Architecture](#frontend-architecture)
9. [User Configuration System](#user-configuration-system)
10. [Audit Trail & Decision History](#audit-trail--decision-history)
11. [Bulk Operations](#bulk-operations)
12. [Failure Modes & Recovery](#failure-modes--recovery)
13. [Deployment & Operations](#deployment--operations)
14. [Security Boundaries](#security-boundaries)
15. [API Versioning](#api-versioning)
16. [Configuration Schema (FINAL)](#configuration-schema-final)
17. [Resource Sizing Guide](#resource-sizing-guide)
18. [Multi-Tenant Stance](#multi-tenant-stance)
19. [Decision Reproducibility](#decision-reproducibility)

---

## Executive Summary

The Agentic Telemetry Operating System is a LLM-powered dashboard for Splunk index optimization. It replaces hardcoded scoring rules with a **single source of truth**: an LLM decision agent (gemma2:9b via Ollama as primary, with gemma4:e4b upgrade path and Anthropic fallback) that evaluates all telemetry data and assigns tier/action recommendations to Splunk indexes.

**Core Principles:**
- **Single Authority:** All decisions come from LLM, never from Python rules or hardcoded heuristics
- **Data Normalization Only:** Python fetches & normalizes Splunk data; doesn't score
- **User-Configurable:** Cost models, retention policies, and decision weights stored in PostgreSQL
- **Audit Trail:** Every decision change is recorded with reason and evidence
- **Non-Fatal Pipeline:** Failures logged but don't break main flow (graceful degradation)
- **Pure Frontend:** SVG/CSS visualization, no external UI libraries

---

## Architectural Tradeoffs & Risk Model

### Primary Architectural Tradeoff

**Local LLM Reliability vs Enterprise-Grade Deterministic Throughput**

This system deliberately chooses **local LLM inference** (Ollama on-premise) over cloud-based deterministic APIs. Critical stability fix: **gemma2:9b is primary model** (proven stable on 16GB), with upgrade paths:

**Model Strategy (Locked via LLM_MODEL Config):**
```
Production:   LLM_MODEL=gemma2:9b (stable, <30GB memory, <10s/batch)
Upgrade Path: LLM_MODEL=gemma4:e4b (requires 32GB+ RAM + GPU)
Fallback:     FALLBACK_MODE=AUTO → Anthropic API (feature-flagged)
```

**Advantages:**
- Zero API latency (local HTTP)
- No external dependencies or rate limits
- Full control over model versions and prompts
- No data leaves organization (Splunk → local LLM → local DB)
- Cost predictability (one-time hardware investment vs per-inference cloud fees)
- gemma2:9b proven stable (no OOM on 16GB, consistent output quality)

**Operational Risks (Mitigated by Model Lock):**
- ~~Ollama process instability~~ → Fixed by gemma2:9b stability + auto-fallback
- Probabilistic outputs even at low temperature (no guaranteed determinism) → Accepted by design
- Sequential inference requirement (MAX_PARALLEL=2, config-driven) → Documented constraint
- Model switching chaos → ELIMINATED by locked LLM_MODEL config (no runtime switching)
- Local hardware capacity bounds → 16GB sufficient for gemma2:9b (gemma4:e4b requires upgrade)

**Recovery Strategy:**
- Anthropic fallback active for all Ollama timeouts (post-batch 2x retry)
- Non-fatal pipeline: individual batch failures don't halt snapshot
- Snapshot immutability: once written, never re-computed (stale is acceptable)
- User can manually trigger re-snapshot after Ollama recovery

---

## Known Constraints & Limitations

### Hardware Constraints

| Constraint | Value | Impact |
|-----------|-------|--------|
| Development environment RAM | 16GB (Mac) | ~100 indexes per batch before OOM |
| Ollama concurrent models | 1 (single GPU) | MAX_PARALLEL=2 sequential processing |
| Batch size | 5 indexes/prompt | Token limit optimization for gemma4:e4b |
| Inference timeout | 30s | Hard deadline for batch response |

### Ollama Instability Scenarios

**Known failure modes:**
- GPU memory exhaustion (Ollama process killed by kernel)
- Floating-point precision issues in inference (outputs NaN scores)
- Network socket timeouts (Ollama hangs on first token generation)
- Model context window overflow (rare, <1% at batch size 5)
- Thermal throttling (GPU overheating on sustained load)

**Indicators to watch:**
- Batch timeout rate >5% (suggests system stress)
- Score distribution with NaN values (Ollama floating-point bug)
- Inference latency >20s/batch (GPU thermal throttle)
- Repeated restart crashes (kernel OOM killer)

### Sequential Inference Requirement

Ollama on consumer hardware cannot parallelize models. This means:
- **MAX_PARALLEL=2** enforced in code (not a performance optimization, a stability requirement)
- Processing 1000 indexes = 200 batches × 5 sec/batch ≈ 17 minutes minimum
- User cannot increase parallelism without upgrading to multi-GPU or distributed Ollama cluster

### Current Implementation vs Target Architecture

**CURRENT (Phase 10):**
- Ollama local inference with Anthropic fallback
- Single-instance PostgreSQL (no replication)
- No distributed cache
- 4-stage pipeline runs synchronously on single thread
- Dashboard reads from single PostgreSQL instance

**TARGET (Future Phases):**
- Distributed Ollama cluster with load balancing
- PostgreSQL read replicas for high-availability
- Redis distributed cache for KPI roll-up
- Async snapshot pipeline with job queue (Celery/BullMQ)
- Multi-region deployment with cross-datacenter replication

Current implementation is **not** designed for multi-tenant or high-throughput scenarios. It's optimized for single-organization, <2000 indexes, weekly refresh cadence.

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

### Decision Scoring Logic (Pure Agentic, No Implicit Rules)

**CRITICAL:** LLM is the **sole decision authority**. Zero implicit rules, zero soft thresholds in prompt.

**What LLM Receives (Signals Only - No Prescriptive Guidance):**

```
Per index:
├─ name: string
├─ sourcetype: string
├─ daily_gb: number
├─ total_events: number
├─ retention_days: number
├─ last_event_date: ISO date
├─ is_scheduled_search: boolean
├─ is_alert: boolean
├─ sourcetype_category: enum (security|operational|business|unknown)
└─ annual_cost_usd: number (derived: daily_gb × retention × cost_per_gb)

User context:
├─ cost_per_gb_per_day: number
├─ retention_policy: { CRITICAL: 730, IMPORTANT: 365, ... }
└─ decision_weights: {} (optional, user override)
```

**What LLM Is NOT Given (Removes Implicit Bias):**
- ❌ "utilization score 0-100" → LLM derives from signals
- ❌ "detection score 0-100" → LLM derives from signals
- ❌ "quality score 0-100" → LLM derives from signals
- ❌ "tier CRITICAL if X > Y" → LLM decides tier based on reasoning
- ❌ "action ARCHIVE if Z happens" → LLM decides action based on reasoning
- ❌ Pre-computed composite scores → LLM computes holistically

**LLM Decision Prompt (Pure Agentic Format):**

```
You are a Splunk index advisor. Based on the signals below, recommend a TIER 
(CRITICAL | IMPORTANT | NICE_TO_HAVE | LOW_VALUE) and ACTION 
(KEEP | OPTIMIZE | ARCHIVE | ELIMINATE | S3_CANDIDATE) for each index.

[Index data formatted as above]

For each index, provide:
1. TIER: Your classification
2. ACTION: Recommended operation
3. CONFIDENCE: 0-1 (how sure you are)
4. REASONING: 1-2 sentence explanation
5. EVIDENCE: 3-5 specific signals that drove this decision
   (e.g., "last event 45 days ago", "zero detected security use", "annual cost $2K")

Do NOT reference any scoring frameworks, thresholds, or rules. 
Decide based purely on the signals and context provided.
```

**What Changes from Old Prompt:**
- ✅ Old: "Score utilization 0-100: count utilization signals"
- ❌ New: No scores requested. LLM naturally considers utilization in reasoning.

- ✅ Old: "If utilization + detection > 150, assign CRITICAL"
- ❌ New: No rules. LLM decides TIER holistically.

**LLM Output (Structured JSON):**

```json
{
  "decisions": [
    {
      "index": "main",
      "sourcetype": "syslog",
      "tier": "CRITICAL",
      "action": "KEEP",
      "confidence": 0.95,
      "reasoning": "Active security data with daily usage and compliance value",
      "evidence": [
        "Last event today (high utilization)",
        "Syslog sourcetype (security-critical)",
        "Daily active searches",
        "Retention policy requires 730 days",
        "Annual cost $5K (justified by detection value)"
      ]
    }
  ]
}
```

**Prompt Versioning (Lightweight Variations Only):**

Instead of major prompt rewrites, use emphasis:
```
// v1 (Balanced - default)
"Based on the signals, recommend tier and action..."

// v2 (Cost-conscious)
"Prioritize cost efficiency. Recommend aggressive optimization..."

// v3 (Security-first)
"Prioritize detection coverage. Keep all security-relevant data..."
```

**Non-Reproducibility Note:**
LLM outputs remain **probabilistic** (inherent to LLMs). To manage variance:
- Lock prompt version: Environment-controlled, never changes mid-run
- Pin model: `LLM_MODEL=gemma2:9b` (locked, no runtime switching)
- Accept ±5-10% variance in tier/action (normal)
- Alert if >30% variance (suggests prompt/data change)
- Use snapshot immutability: decisions never re-computed

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

## Failure Modes & Recovery

### Scenario 1: Ollama Unavailable / Timeout

**Detection:**
- POST to http://localhost:11434/api/generate returns 500 or timeout (>30s)
- Occurs during Stage 3 (LLM batch processing)

**Immediate Response:**
1. Retry up to 2x (total 3 attempts), each with fresh timeout
2. If all 3 fail: Log batch failure, activate Anthropic fallback
3. If Anthropic also unavailable: Skip batch, log error, continue with remaining batches
4. Non-fatal: Pipeline continues, snapshot is written with partial decisions (some batches skipped)

**Recovery Steps:**
1. Check Ollama health: `curl http://localhost:11434/api/tags`
2. Check Docker logs: `docker logs ollama | tail -50`
3. If OOM: Reduce batch size from 5 to 3 in TelemetryDecisionAgent
4. Restart Ollama: `docker-compose restart ollama && sleep 30`
5. Trigger fresh snapshot: User clicks "Refresh" button in dashboard
6. Verify: Check `llm_prompt_versions` for fallback model used

**Prevention:**
- Monitor Ollama health every 5 minutes (Docker healthcheck runs continuously)
- Set up alerting on batch timeout rate >5%
- Pre-warm Ollama model on startup (auto-pull in bootstrap script)

### Scenario 2: Splunk API Timeout / Authentication Failure

**Detection:**
- Stage 1 fetch fails (Splunk API unreachable or credentials invalid)
- Occurs during aggregation-service.fetchTelemetry()

**Immediate Response:**
1. Log error with Splunk host/port
2. Check cached data: if previous snapshot exists (age < 24h), use cached instead
3. Notify user: Dashboard shows "Using cached data from [timestamp]"
4. Non-fatal: Pipeline reads from DB, doesn't fetch fresh Splunk data

**Recovery Steps:**
1. Verify Splunk connectivity: `curl -k https://splunk:8089/services/appserver/info`
2. Check credentials: Verify `SPLUNK_USERNAME`, `SPLUNK_PASSWORD` env vars
3. Check Splunk health: Splunk UI at https://splunk:8000
4. Increase timeout: Set `SPLUNK_QUERY_TIMEOUT_MS=60000` (default 30000)
5. Retry fetch: Trigger fresh snapshot from dashboard
6. If persistent: Check firewall rules, VPN, network connectivity

**Prevention:**
- Health-check Splunk on startup (before accepting requests)
- Maintain rolling 7-day cache (snapshots never older than 7 days)
- Alert if fresh snapshot hasn't succeeded in 7 days

### Scenario 3: PostgreSQL Write Failure / Partial Commit

**Detection:**
- INSERT fails during Stage 4 (persist phase)
- Transaction partially committed (some rows inserted, others failed)

**Immediate Response:**
1. Rollback transaction (ABORT in PostgreSQL)
2. Log error with table name and row count
3. Do NOT retry: Snapshot remains uncommitted
4. Dashboard continues reading from previous snapshot

**Recovery Steps:**
1. Check DB connection: `psql -c "SELECT 1"`
2. Check disk space: `df -h /var/lib/postgresql/data` (goal: >10GB free)
3. Check table locks: `SELECT * FROM pg_locks WHERE NOT granted`
4. Check transaction isolation: Verify no long-running transactions blocking
5. Increase work_mem in postgresql.conf: `work_mem = '256MB'` (default 4MB)
6. Retry snapshot: Trigger fresh refresh from dashboard

**Prevention:**
- Monitor disk space (alert if <20% free)
- Set up VACUUM jobs to prevent table bloat (daily at 2 AM)
- Increase `max_connections` if many concurrent readers
- Monitor slow queries: Enable log_min_duration_statement = 5000 (log queries >5s)

### Scenario 4: Database Migration Failure

**Detection:**
- Migration script fails during startup (e.g., schema change on large table blocks)
- Dashboard refuses to start (health check fails)

**Immediate Response:**
1. Rollback migration: `psql -c "ROLLBACK TRANSACTION"` (if in progress)
2. Check postgres logs for error details
3. Verify schema state: `SELECT * FROM information_schema.tables`

**Recovery Steps:**
1. Determine which migration failed: Check `schema_migrations` table
2. Manually revert schema changes if necessary
3. Check for blocking locks: Kill long-running transactions
4. For large table migrations: Create CONCURRENTLY index instead of blocking
5. Re-run bootstrap: `npm run db:migrate`

**Prevention:**
- Test migrations on staging database first
- Use CONCURRENTLY option for index creation (non-blocking)
- Set statement_timeout = 300000 for migrations (5 min)
- Backup database before migrations: `pg_dump -Fc > backup.dump`

### Scenario 5: Stale Snapshot Recovery

**Detection:**
- Last successful snapshot is >7 days old
- User views outdated KPIs, not fresh data

**Immediate Response:**
1. Dashboard shows warning banner: "Data is 7 days old. Last refresh failed."
2. Display last known error (Splunk timeout? Ollama crash?)
3. Offer "Retry Refresh" button

**Recovery Steps:**
1. Address root cause (see Scenarios 1-4)
2. Trigger fresh snapshot from dashboard
3. If still fails after 3 attempts: Escalate to ops team
4. Manual override: Admin can force use of 7-day-old snapshot (bypasses freshness check)

**Prevention:**
- Automated retry job (every 6 hours if snapshot fails)
- Alert on stale snapshot (>48h old)
- Document SLA: "Fresh snapshot every 24h or alert escalates"

---

## Security Boundaries

### Data Flow Isolation

```
[Splunk API]
    ↓ (Only AggregationService can access)
[PostgreSQL] ← Normalized data stored here
    ↓ (Backend reads, TelemetryDecisionAgent reads)
[Ollama LLM] ← Receives normalized data (no raw Splunk auth)
    ↓ (Decisions written back to DB)
[PostgreSQL] ← Decisions stored here
    ↓ (Frontend reads via API only)
[Dashboard UI] ← No direct Splunk/Ollama access
```

**Critical Boundaries:**
1. **Frontend NEVER directly calls Splunk API** — All data read from PostgreSQL via `/api/*` routes
2. **Frontend NEVER directly calls Ollama** — All decisions pre-computed and cached
3. **LLM NEVER receives Splunk credentials** — Only raw metrics (GB, event count, etc.)
4. **LLM NEVER accesses Splunk** — Only receives normalized data prepared by backend
5. **Splunk credentials stored ONLY in AggregationService.ts** — Never logged, never sent to LLM

### Authentication Model

- **No user login:** System assumes organizational proxy (VPN/SSO at network edge)
- **Splunk auth:** Username/password or token from environment variables
- **Database auth:** PostgreSQL connection string from environment variables
- **API keys:** Anthropic API key only used for LLM fallback, never logged

### Credential Handling

```
Environment (Host)
    ↓
EnvVar (SPLUNK_PASSWORD, DATABASE_URL)
    ↓ (Never logged)
Runtime Memory (AggregationService)
    ↓ (Used only when fetching)
Network Request (HTTPS only)
    ↓
External System (Splunk, Anthropic)
```

Never:
- Log credentials
- Pass credentials to frontend
- Include in error messages
- Store in database
- Commit to git

---

## Snapshot Immutability Policy

### Definition

Once a snapshot is written to `telemetry_snapshots` and related tables, it **NEVER changes**. Snapshots are append-only.

### Rationale

1. **Audit trail integrity:** Decision history tracks changes relative to snapshot baseline
2. **Reproducibility:** Same snapshot ID always returns same data (no hidden mutations)
3. **Compliance:** Immutable record satisfies regulatory audit requirements
4. **Cache safety:** Frontend can safely cache snapshot data indefinitely

### Implications

- **No "undo":** If user applies bulk action and regrets, they must create new snapshot (click Refresh)
- **No corrections:** If LLM makes bad decision, create new snapshot with updated prompt version
- **New data always:** Each refresh creates new snapshot ID, never overwrites old one
- **Old snapshots visible:** DecisionHistoryViewer shows old snapshots (7-90 day retention)

### Implementation

All INSERT operations to `telemetry_snapshots`:
```sql
INSERT INTO telemetry_snapshots (...) VALUES (...);
-- Never UPDATE, never DELETE (retention job only)
```

Decision history tracks changes **across snapshots**:
```
Snapshot 101: index="main", action="KEEP"
Snapshot 102: index="main", action="OPTIMIZE"  ← decision_history records change
```

---

## API Versioning

### Current Strategy (Implicit Versioning)

**API Version:** v1 (implicit, no `/v1/` prefix in routes)

Routes:
- `/api/executive-summary` → always returns latest schema
- `/api/agent-decisions` → always returns latest schema
- `/api/config` → always returns latest schema
- `/api/decision-history` → always returns latest schema
- `/api/bulk-actions` → always returns latest schema

### Backward Compatibility Policy

**Breaking Changes** (require major version bump):
- Removing a field from response JSON
- Changing field type (e.g., number → string)
- Changing endpoint path
- Changing HTTP verb (GET → POST)

**Safe Changes** (no version bump):
- Adding new optional fields to response
- Adding new query parameters (existing code unaffected)
- Returning more data in paginated response
- Changing internal implementation (same external contract)

### Migration Path for v2 (Future)

If breaking changes required:
```
GET /api/v1/executive-summary  ← Old schema (deprecated, 6-month support window)
GET /api/v2/executive-summary  ← New schema (preferred)
GET /api/executive-summary     ← Alias to v1 initially, then v2
```

Frontend code:
```typescript
const url = import.meta.env.VITE_API_VERSION === 'v2' 
  ? '/api/v2/executive-summary'
  : '/api/executive-summary'
```

---

## Configuration Schema (FINAL)

### Environment Variables (CRITICAL CONTROLS)

```bash
# === LLM MODEL (LOCKED - NO RUNTIME SWITCHING) ===
LLM_MODEL=gemma2:9b                    # Primary: stable, 16GB safe
                                        # Options: gemma2:9b, gemma4:e4b
                                        # MUST be set; system fails if unavailable

# === FALLBACK STRATEGY ===
FALLBACK_MODE=AUTO                      # OFF | AUTO | MANUAL
                                        # AUTO: fallback to Anthropic on timeout
                                        # MANUAL: require user approval
                                        # OFF: fail hard (no fallback)

ANTHROPIC_API_KEY=sk-ant-***           # Required if FALLBACK_MODE != OFF

# === PIPELINE TIMEOUTS (GLOBAL CONTROLS) ===
TOTAL_PIPELINE_TIMEOUT=120000           # 120 seconds (milliseconds)
                                        # Total time from start to finish
                                        # If exceeded: abort, use cached snapshot

SPLUNK_QUERY_TIMEOUT=30000              # 30 seconds (Splunk fetch only)
                                        # If exceeded: retry 2x, then timeout

LLM_BATCH_TIMEOUT=30000                 # 30 seconds (per batch, 5 indexes)
                                        # If exceeded: retry 2x, fallback, skip batch

# === PARALLELISM (CONFIG-DRIVEN) ===
MAX_PARALLEL_INDEXES=2                  # Ollama constraint: sequential batches
                                        # DO NOT INCREASE without GPU upgrade
                                        # Constraint: Ollama single-model-instance

# === SPLUNK QUERY SCOPE ===
LOOKBACK_WINDOW_DAYS=7                  # Data lookback for Splunk queries
                                        # Options: 1, 7, 30, 90 (days)
                                        # Affects snapshot freshness vs performance
                                        # Default: 7 days (weekly snapshot cadence)

# === BATCHING ===
BATCH_SIZE=5                            # Indexes per LLM prompt
                                        # Optimized for gemma2:9b context window
                                        # DO NOT CHANGE without LLM testing

# === DATABASE ===
DATABASE_URL=postgresql://user:pass@localhost:5432/telemetry_db
MAX_DB_CONNECTIONS=20                   # Connection pool size
MIGRATION_LOCK_TIMEOUT=300              # Seconds (migration safeguard)

# === OBSERVABILITY ===
LOG_LEVEL=INFO                          # DEBUG | INFO | WARN | ERROR
METRICS_ENABLED=true                    # Enable system_metrics table logging
PROFILE_ENABLED=false                   # Enable timing instrumentation

# === SPLUNK ===
SPLUNK_HOST=splunk.example.com
SPLUNK_PORT=8089
SPLUNK_USERNAME=admin
SPLUNK_PASSWORD=***
# OR use token auth:
SPLUNK_AUTH_TOKEN=***
```

### Database Configuration Table (user_config)

```sql
CREATE TABLE IF NOT EXISTS user_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    
    -- Cost Model (User Configurable)
    cost_per_gb_per_day DECIMAL(8,2) NOT NULL DEFAULT 0.50,
    
    -- Retention Policy (User Configurable)
    retention_policy JSONB DEFAULT '{
        "CRITICAL": 730,
        "IMPORTANT": 365,
        "NICE_TO_HAVE": 90,
        "LOW_VALUE": 30
    }',
    
    -- LLM Weights (Optional, Advanced)
    decision_weights JSONB DEFAULT '{}',
    
    -- System Config (Locked)
    lookback_window_days INTEGER NOT NULL DEFAULT 7,
    max_parallel INTEGER NOT NULL DEFAULT 2,
    batch_size INTEGER NOT NULL DEFAULT 5,
    total_pipeline_timeout_ms INTEGER NOT NULL DEFAULT 120000,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Migration Safeguards (NEW)

```sql
CREATE TABLE IF NOT EXISTS migration_lock (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    lock_acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lock_holder VARCHAR(255) NOT NULL,  -- Hostname of process
    checksum VARCHAR(64) NOT NULL,      -- SHA256 of migration SQL
    status VARCHAR(20) NOT NULL,        -- PENDING | IN_PROGRESS | COMPLETED | FAILED
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_checksums (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    expected_checksum VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### System Metrics Table (NEW - Observability)

```sql
CREATE TABLE IF NOT EXISTS system_metrics (
    id SERIAL PRIMARY KEY,
    metric_type VARCHAR(50) NOT NULL,   -- llm_latency | batch_timeout | db_write_ms
    metric_value DECIMAL(10,2) NOT NULL,
    metric_unit VARCHAR(20) NOT NULL,   -- ms | count | percent
    snapshot_id INTEGER,
    batch_number INTEGER,
    context JSONB DEFAULT '{}',         -- Additional context (model, batch_size, etc)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_metric_type (metric_type),
    INDEX idx_created_at (created_at)
);
```

### Bootstrap Script Updates

```bash
#!/bin/bash
# scripts/bootstrap.sh (UPDATED)

# Validate config BEFORE starting services
if [ -z "$LLM_MODEL" ]; then
    echo "❌ ERROR: LLM_MODEL not set. Exiting."
    exit 1
fi

# Check model availability
docker run --rm ollama/ollama:latest ollama list | grep -q "$LLM_MODEL"
if [ $? -ne 0 ]; then
    echo "❌ ERROR: Model $LLM_MODEL not available. Pulling..."
    docker exec ollama ollama pull "$LLM_MODEL" || exit 1
fi

# Validate timeouts
if [ "$TOTAL_PIPELINE_TIMEOUT" -lt "$LLM_BATCH_TIMEOUT" ]; then
    echo "❌ ERROR: TOTAL_PIPELINE_TIMEOUT must be >= LLM_BATCH_TIMEOUT"
    exit 1
fi

# Validate parallelism
if [ "$MAX_PARALLEL_INDEXES" -gt 2 ]; then
    echo "⚠️  WARNING: MAX_PARALLEL_INDEXES > 2 may cause Ollama instability"
fi

echo "✅ Configuration validated. Starting stack..."
```

### Config Validation Rules

| Parameter | Min | Max | Default | Enforced |
|-----------|-----|-----|---------|----------|
| cost_per_gb_per_day | 0.10 | 2.00 | 0.50 | UI slider |
| lookback_window_days | 1 | 90 | 7 | None (user choice) |
| max_parallel_indexes | 1 | 2 | 2 | Hard limit |
| batch_size | 1 | 10 | 5 | Hard (context window) |
| total_pipeline_timeout_ms | 60000 | 600000 | 120000 | Fail-fast |
| splunk_query_timeout | 10000 | 60000 | 30000 | Retry 2x |
| llm_batch_timeout | 10000 | 60000 | 30000 | Retry 2x, fallback |

### Config-Driven Behavior Examples

```typescript
// LLM Model Selection (LOCKED)
const model = process.env.LLM_MODEL;
if (!model) throw new Error('LLM_MODEL required');
if (model !== 'gemma2:9b' && model !== 'gemma4:e4b') {
  throw new Error(`Invalid LLM_MODEL: ${model}`);
}
// ✅ No runtime switching: model is set at startup, never changes

// Fallback Strategy (FEATURE-FLAGGED)
if (ollamaTimeout && process.env.FALLBACK_MODE === 'AUTO') {
  // Fallback to Anthropic
} else if (ollamaTimeout && process.env.FALLBACK_MODE === 'OFF') {
  // Fail hard, skip batch
} else {
  // MANUAL: require user approval
}

// Global Timeout Enforcement
const startTime = Date.now();
const deadline = startTime + TOTAL_PIPELINE_TIMEOUT;
if (Date.now() > deadline) {
  // Abort pipeline, use cached snapshot
  logger.warn('Pipeline timeout exceeded, using cache');
  return cachedSnapshot;
}

// Config-Driven Parallelism
for (let i = 0; i < batches.length; i += MAX_PARALLEL) {
  // Process max MAX_PARALLEL batches concurrently
  // Respects config, never exceeds it
}
```

---

## Resource Sizing Guide

### Minimum Configuration (Development / Single User)

| Resource | Recommended | Notes |
|----------|------------|-------|
| Host RAM | 16GB | Supports ~100 indexes per batch |
| Docker resources | 8GB allocated | LLM inference requires ~6GB |
| PostgreSQL volume | 50GB | 90 days of snapshots |
| Network bandwidth | 100 Mbps | Splunk query throughput |
| Ollama GPU (optional) | None (CPU ok) | gemma4:e4b runs on CPU, slow (~30s/batch) |

**Inference Latency (Development):**
- CPU-only: 30-45s per batch (5 indexes)
- GPU (NVIDIA RTX 4060): 5-8s per batch
- GPU (NVIDIA A100): 2-3s per batch

### Recommended Configuration (Production Single-Org)

| Resource | Recommended | Justification |
|----------|------------|-------|
| Host RAM | 32GB | Ollama +6GB, PostgreSQL +4GB, buffer +4GB |
| Docker resources | 16GB allocated to Ollama | Larger model context, faster inference |
| PostgreSQL volume | 500GB | 2+ years of snapshots, search audit, history |
| Network | 1 Gbps to Splunk | Concurrent index metric queries |
| Ollama GPU | NVIDIA RTX 4090 (24GB) | Supports 2-3 parallel inferences |
| PostgreSQL replicas | 1 read replica | HA failover, zero-downtime maintenance |

**Inference Latency (Production):**
- Typical: 5-7s per batch (5 indexes)
- Peak (GPU thermal throttle): 15-20s per batch
- Sustained (multi-day refresh): 7-10s per batch average

### Capacity Planning Formula

For N indexes, weekly refresh cadence:
```
Inference time = (N / 5) batches × 6s/batch × 1.5 (overhead) = ~2s per index
Example: 2000 indexes = 2000 × 2s = 4000s ≈ 67 minutes
```

Storage for 90-day retention:
```
Per snapshot ≈ (N × 500 bytes) = 1MB per 2000 indexes
Per day = 1 snapshot × 1MB = 1MB/day
90 days = 90MB per index tier (agent_decisions)
Decision history (changes only) = ~10% of decisions table
Total = ~100MB per 2000 indexes per 90 days
```

---

## Multi-Tenant Stance

### Current Support

**Multi-tenancy:** ❌ NOT SUPPORTED

This is a deliberate architectural choice, not a limitation.

### Single-Tenant Only

The system is explicitly designed for **one organization, one Splunk instance, one cost model**:

**Single source of truth:**
```sql
user_config
├─ cost_per_gb_per_day (one value, applies to all indexes)
├─ decision_weights (one value, applies to all indexes)
└─ retention_policy (one value, applies globally)
```

If you need per-tenant config, you would need **separate deployments**:
```
Tenant A: db_a, ollama_a, dashboard_a (independent)
Tenant B: db_b, ollama_b, dashboard_b (independent)
Splunk Enterprise: shared (proxied/routed by department)
```

### Multi-Tenant Workaround (If Required)

To support multiple tenants without code changes:
1. Deploy separate stacks (Docker Compose per tenant)
2. Each tenant has own PostgreSQL, own Ollama, own dashboard
3. Route Splunk queries by user LDAP group to correct tenant dashboard
4. Share Ollama model files via NFS (save ~5GB per tenant)

### Why Not Multi-Tenant

**Complexity vs ROI:**
- Cost model MUST be per-tenant (different cost structures)
- Isolation requires row-level security (PostgreSQL complexity)
- Ollama model would need request queueing (thread pool complexity)
- Audit trail becomes tenant-aware (schema changes)
- Testing effort increases 3x

**Better Use Case:**
If supporting >3 tenants, use cloud API (Anthropic) instead of local Ollama. Multi-tenancy pays for itself through cloud infrastructure.

---

## Decision Reproducibility

### Probabilistic by Design

LLM outputs are **inherently non-deterministic**, even at temperature=0.3.

**Reproducibility Guarantee:** ❌ NONE

Same inputs MAY produce different tier/action on successive runs.

### Why Reproducibility Matters (And Why We Accept Non-Reproducibility)

**Use Cases Requiring Reproducibility:**
- Regulatory audits ("why did you eliminate this index?")
- A/B testing LLM prompt versions
- Debugging specific decisions

**Our Approach:**
- **NOT:** Force reproducibility (impossible with LLMs)
- **BUT:** Make decisions **auditable** and **explainable**

### Auditability Strategy

Every decision includes:
```sql
agent_decisions:
├─ reasoning (text): Full LLM explanation
├─ evidence[] (array): Specific facts that drove decision
├─ llm_model_used: "gemma4:e4b-v2.0" (model version)
├─ snapshot_id: Links to prompt version
└─ created_at: Timestamp (enables version lookup)

llm_prompt_versions:
├─ version: "1", "2", "3" (incremented)
├─ prompt_template: Exact prompt used
├─ model_name: "gemma4:e4b"
├─ activated_at: When this version went live
└─ notes: What changed from previous version
```

**Audit Trail:**
```
User asks: "Why was index X eliminated in snapshot Y?"
Answer:
1. Query agent_decisions WHERE snapshot_id=Y AND index_name='X'
2. Read reasoning: "Low utilization (2 events/day), no security value, retention 14 days"
3. Read evidence: ["lastEvent < 30 days ago", "totalEvents < 1000", "sourcetype != security"]
4. Read prompt_template from llm_prompt_versions WHERE version=1
5. Share evidence + reasoning + prompt with user → explains decision rationale
```

### Consistency Without Reproducibility

To maintain consistency across runs:
1. **Lock prompt version** — Don't change LLM prompt mid-month
2. **Pin model version** — Document which gemma4:e4b version was used
3. **Accept variation** — Tier/action may shift 5-10% between runs (normal)
4. **Alert on major shifts** — If 20% of indexes change action, investigate prompt/data change
5. **Snapshot immutability** — Old decisions don't re-compute, so user sees historical consistency

### Testing for Consistency

```typescript
// Test: Run LLM on same 100 indexes 3x in a row
const run1 = await runLLMDecisionAgent(indexes, config);
const run2 = await runLLMDecisionAgent(indexes, config);
const run3 = await runLLMDecisionAgent(indexes, config);

// Measure: What % of decisions differ across runs?
const diffPercentage = calculateDifferences(run1, run2, run3);
// Expected: 5-15% differ (normal LLM variance)
// Alert if: >30% differ (suggests Ollama instability or prompt issues)
```

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

## Data Retention & Cleanup Jobs

### Retention Policy

```sql
telemetry_snapshots:     Keep 90 days (rolling window)
executive_kpis:          Keep 90 days
agent_decisions:         Keep 90 days
decision_history:        Keep 1 year (audit trail)
config_audit_log:        Keep 2 years (compliance)
search_audit:            Keep 30 days
field_usage:             Keep 30 days
security_coverage:       Keep 30 days
quality_hotspots:        Keep 30 days
```

### Cleanup Job Ownership

**Option A: PostgreSQL Native (RECOMMENDED)**
- Owner: PostgreSQL (scheduled via pg_cron extension)
- Schedule: Daily at 02:00 UTC (low-traffic time)
- Implementation:
```sql
SELECT cron.schedule('cleanup-snapshots', '0 2 * * *',
  $$DELETE FROM telemetry_snapshots WHERE snapshot_date < NOW() - INTERVAL '90 days'$$);
```

**Option B: Application Layer**
- Owner: Backend service (Node.js cron job)
- Schedule: Daily at 02:00 UTC
- File: `apps/api/services/retention-cleanup.ts`
- Implementation: Called from `/api/cache-status` endpoint health check

**Option C: External Scheduler**
- Owner: Kubernetes CronJob or systemd timer
- Schedule: Daily at 02:00 UTC
- Command: `npm run db:cleanup`
- Advantages: Works without pg_cron extension, visible in CI/CD

**Recommended:** Option A (PostgreSQL native) — least operational overhead, runs independently

### Cleanup Monitoring

```
Alert if:
├─ Cleanup job doesn't run for 3 consecutive days
├─ Cleanup takes >30 minutes (suggests table lock)
├─ Cleanup deletes <100K rows (suggests broken query)
└─ Disk space <20% (cleanup not keeping up)
```

Monitor via:
```sql
SELECT * FROM cron.job_run_details WHERE jobid = (
  SELECT jobid FROM cron.job WHERE jobname = 'cleanup-snapshots'
) ORDER BY start_time DESC LIMIT 10;
```

---

## Operational Flow Diagrams

### Snapshot Refresh Sequence

```
User clicks "Refresh" button
    ↓
POST /api/cache-status (triggers aggregation)
    ↓
AggregationService.runAggregation()
    ├─→ Stage 1: Fetch Splunk (timeout: 30s × 2 retries)
    │   └─ Error → Log, use cached data, return 202 (Accepted)
    │
    ├─→ Stage 2: Normalize (local, ~5s)
    │   └─ Error → Log, continue with partial data
    │
    ├─→ Stage 3: LLM Batch Process (timeout: 30s × 2 retries per batch)
    │   ├─ Batch 1 indexes 1-5: POST Ollama → parse → validate
    │   ├─ Batch 2 indexes 6-10: POST Ollama → parse → validate
    │   ├─ Batch N indexes (N-1)-N: POST Ollama → parse → validate
    │   └─ Error on batch → Log, fallback Anthropic, skip if both fail
    │
    ├─→ Stage 4: Persist to PostgreSQL
    │   ├─ BEGIN TRANSACTION
    │   ├─ INSERT telemetry_snapshots (new snapshot ID)
    │   ├─ INSERT executive_kpis (aggregate metrics)
    │   ├─ INSERT agent_decisions (all decisions)
    │   ├─ INSERT decision_history (if action changed)
    │   ├─ INSERT search_audit (orphan searches)
    │   └─ COMMIT or ROLLBACK (if any INSERT fails)
    │
    └─→ Return 201 (Created) with snapshot ID

Frontend:
    ├─ Poll /api/cache-status every 2s (checks snapshot_id)
    ├─ If snapshot_id changes → Refetch /api/executive-summary
    └─ Render dashboard with new KPIs
```

### LLM Decision Process (Per Batch)

```
Stage 3: TelemetryDecisionAgent.runLLMDecisionAgent()
    ├─ Batch 5 indexes
    ├─ buildDecisionPrompt(indexes, userConfig, costModel)
    │   └─ Format: [index info] + [cost context] + [decision request]
    │
    ├─ POST http://localhost:11434/api/generate
    │   ├─ model: "gemma4:e4b"
    │   ├─ temperature: 0.3 (lower = more consistent)
    │   ├─ timeout: 30000ms
    │   └─ stream: false
    │
    ├─ On response (or 30s timeout):
    │   ├─ If success: parseDecisionOutput(response.text)
    │   ├─ If timeout (attempt 1-2): Retry
    │   └─ If timeout (attempt 3): Fallback Anthropic
    │
    ├─ parseDecisionOutput(llmText)
    │   ├─ Search for JSON block
    │   ├─ Extract decisions[]
    │   └─ Return LLMDecision[] or error
    │
    └─ validateDecision(each decision)
        ├─ Check: tier in enum, action in enum, scores 0-100
        └─ Skip invalid, log error, continue
```

### Failure Recovery Loop

```
Snapshot refresh fails
    ↓
aggregation-service catches error
    ├─ Is it fatal? (network down, DB unreachable)
    │   └─ Yes: Stop, return error, don't write partial snapshot
    │
    └─ Is it recoverable? (Ollama timeout, Splunk timeout)
        ├─ Retry stage (with backoff)
        │   ├─ Retry 1: 2s wait, retry
        │   ├─ Retry 2: 5s wait, retry
        │   └─ Retry 3: Fallback (Anthropic) or skip (accept stale snapshot)
        │
        └─ Non-fatal: Continue pipeline
            ├─ Write snapshot with "partial" flag if some batches failed
            └─ Dashboard shows warning: "Data incomplete, N indexes processed"
```

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

## Cold Start UX & Connection Gating

### First-Time User Experience

**Current State:** Dashboard loads blank/unclear if Splunk not configured.

**Fixed UX Flow:**

```
1. User navigates to http://localhost:3002

2. Dashboard checks: Is Splunk configured?
   ├─ If NO:
   │   └─ Show connection banner (full-width, blue/info color)
   │       ├─ Icon: 🔌
   │       ├─ Title: "Connect Splunk to Get Started"
   │       ├─ Description: "Dashboard needs Splunk credentials to fetch index metrics"
   │       ├─ Button: "Go to Settings" → /settings page
   │       └─ Disable all dashboard interactive elements
   │
   └─ If YES:
       ├─ Check: Is first snapshot available?
       │   ├─ If NO:
       │   │   └─ Show: "Click 'Refresh' to create first snapshot"
       │   │       └─ Button: "Refresh" → POST /api/cache-status
       │   │
       │   └─ If YES:
       │       └─ Render: Full dashboard with data

3. Settings Page (/settings):
   ├─ Splunk Connection Form:
   │   ├─ Host: input (required)
   │   ├─ Port: input (default 8089)
   │   ├─ Username: input (required)
   │   ├─ Password: input (required, masked)
   │   └─ Auth Token: input (alternative to password)
   │
   ├─ Test Connection: button
   │   └─ On click: POST /api/test-splunk-connection
   │       └─ Returns: { success: boolean, message: string }
   │
   └─ Save: button
       └─ Persists to env vars (or secure store)
       └─ Redirects to / (dashboard home)
```

### Implementation Details

**Frontend Check:**

```typescript
// pages/_app.tsx or app.tsx
const [splunkConfigured, setSplunkConfigured] = useState(false);

useEffect(() => {
  fetch('/api/cache-status')
    .then(r => r.json())
    .then(d => {
      if (!d.splunk_configured) {
        setSplunkConfigured(false);
      } else {
        setSplunkConfigured(true);
      }
    });
}, []);

if (!splunkConfigured) {
  return <ConnectionGatedUI />;
}

return <Dashboard />;
```

**Backend Route:**

```typescript
// /api/cache-status (updated to include config status)
export async function GET(request: NextRequest) {
  return NextResponse.json({
    splunk_configured: !!process.env.SPLUNK_HOST,
    splunk_host: process.env.SPLUNK_HOST,
    last_snapshot_id: await getLatestSnapshotId(),
    last_snapshot_date: await getLatestSnapshotDate(),
    cache_fresh: /* ... */
  });
}

// /api/test-splunk-connection (new endpoint)
export async function POST(request: NextRequest) {
  const { host, port, username, password, auth_token } = await request.json();
  
  try {
    // Test connection to Splunk
    const response = await fetch(`https://${host}:${port}/services/appserver/info`, {
      headers: {
        'Authorization': auth_token ? `Bearer ${auth_token}` : 
                        `Basic ${btoa(username + ':' + password)}`
      }
    });
    
    if (response.ok) {
      return NextResponse.json({ success: true, message: 'Connected to Splunk' });
    } else {
      return NextResponse.json({ 
        success: false, 
        message: `Splunk returned ${response.status}` 
      });
    }
  } catch (err) {
    return NextResponse.json({ 
      success: false, 
      message: `Connection failed: ${err.message}` 
    });
  }
}
```

---

## System Observability & Instrumentation

### Metrics Collection (NEW)

Add timing instrumentation to pipeline:

```typescript
// apps/api/services/aggregation-service.ts
class MetricsCollector {
  async recordMetric(type: string, value: number, unit: string, context?: any) {
    if (!process.env.METRICS_ENABLED) return;
    
    const client = await getConnectionPool();
    await client.query(
      `INSERT INTO system_metrics (metric_type, metric_value, metric_unit, context, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [type, value, unit, JSON.stringify(context || {})]
    );
    client.release();
  }
}

// Use throughout pipeline:
const metrics = new MetricsCollector();

// Stage 1: Splunk fetch
const t1 = Date.now();
const splunkData = await aggregation.fetchTelemetry();
await metrics.recordMetric('splunk_fetch_ms', Date.now() - t1, 'ms', {
  index_count: splunkData.length
});

// Stage 3: LLM batch
const batchStart = Date.now();
const decisions = await llmAgent.runBatch(batch);
await metrics.recordMetric('llm_batch_ms', Date.now() - batchStart, 'ms', {
  batch_number: i,
  index_count: batch.length,
  model: process.env.LLM_MODEL,
  timeout: decisions.some(d => d.timedOut)
});

// Stage 4: Database write
const dbStart = Date.now();
await persistSnapshot(snapshot);
await metrics.recordMetric('db_write_ms', Date.now() - dbStart, 'ms', {
  decision_count: snapshot.decisions.length,
  table: 'agent_decisions'
});
```

### Observability Dashboard (Optional - Grafana)

```sql
-- Query for LLM inference performance
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  AVG(metric_value) as avg_latency_ms,
  MAX(metric_value) as max_latency_ms,
  COUNT(*) as inference_count
FROM system_metrics
WHERE metric_type = 'llm_batch_ms'
GROUP BY hour
ORDER BY hour DESC
LIMIT 24;

-- Query for pipeline health
SELECT 
  metric_type,
  COUNT(*) as event_count,
  AVG(metric_value) as avg_value,
  MAX(metric_value) as max_value
FROM system_metrics
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY metric_type;
```

---

## PDF Alignment & UI Gaps

### Executive Dashboard (v3) Gaps

**Missing from current implementation:**

1. **Cost Sensitivity Tooltip**
   - Current: Cost slider with no explanation
   - Fix: Hover → show formula
   ```
   Annual Cost = daily_gb × retention_days × cost_per_gb_per_day
   Example: 100 GB × 365 days × $0.50 = $18,250/year
   ```

2. **ROI vs GainScope Visual Balance**
   - Current: Two gauges, similar size
   - Fix: Add subtitle explaining each
   ```
   ROI Score: "Based on tier distribution (critical/important weight heavier)"
   GainScope Score: "Based on action distribution (eliminate/archive weight heavier)"
   ```

3. **Unified Drill-Down (Some sections clickable, some not)**
   - Current: Quick wins table has drill-down, gauges don't
   - Fix: **Every interactive element** → ReasoningDrawer
   ```
   ✅ Quick wins rows → drill-down
   ✅ KPI gauge values → drill-down (formula + inputs)
   ✅ Savings staircase bars → drill-down (which indexes)
   ✅ Tier distribution pie → drill-down (which tier, which indexes)
   ✅ Scatter plot bubbles → drill-down (index details)
   ```

### Detail Dashboard (v4) Gaps

1. **Decision Trace Chain Missing**
   - Current: Table rows show decision, no trace back
   - Fix: Add expandable chain:
   ```
   Row click → ReasoningDrawer shows:
   ├─ Signals (raw data: GB, events, last event date)
   ├─ Patterns (what LLM detected: low utilization, no security use)
   ├─ Decision (tier=LOW_VALUE, action=ELIMINATE)
   └─ Evidence (3-5 specific signals)
   ```

2. **Grouping Not Enforced**
   - Current: 9 tables loose on page
   - Fix: Group by category:
   ```
   Security Section:
   ├─ Security Gaps table
   └─ Detection Coverage table
   
   Quality Section:
   ├─ Quality Hotspots table
   └─ Field Usage table
   
   Cost Section:
   ├─ Retention Policy table
   ├─ Savings Potential table
   └─ Cost Analysis table
   
   Operational Section:
   ├─ Search Audit table
   └─ Index Health table
   ```

3. **Consistency Enforcement**
   - Current: Some rows expandable, some not
   - Fix: **Every row → ReasoningDrawer**
   ```
   For each row in every table:
   └─ Click row or info icon → ReasoningDrawer
       ├─ Title: index name + metric
       ├─ Signals: raw data that drove decision
       ├─ LLM Reasoning: what the model said
       └─ Evidence: specific facts
   ```

---

## Operational Checklist

**Dashboard loads forever:**
- Check Splunk: curl -k https://splunk:8089/services/appserver/info
- Check DB: psql -c "SELECT 1 FROM telemetry_snapshots LIMIT 1"
- Check Ollama: curl http://localhost:11434/api/tags
- Check logs: docker logs web

**LLM decisions look wrong:**
- Check model: `echo $LLM_MODEL` (should be gemma2:9b)
- Check prompt version: SELECT from llm_prompt_versions
- Review evidence: expand ReasoningDrawer
- Check Ollama logs: docker logs ollama

**Old data not pruned:**
- Manual cleanup: DELETE FROM telemetry_snapshots WHERE snapshot_date < NOW() - INTERVAL '90 days'

**Configuration not applied:**
- Verify env vars: `env | grep LLM_MODEL` (must be set)
- Verify no model switching in logs (search for "switching model")
- Verify timeouts enforced: logs should show "TOTAL_PIPELINE_TIMEOUT exceeded"

---

**Document Version:** 2.0 (Critical Stability & Config Updates)  
**Last Reviewed:** 2026-05-16  
**Status:** Production-Ready with Stability Fixes (gemma2:9b primary, config-driven controls, cold start UX, observability)
