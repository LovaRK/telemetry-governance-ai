# Agentic Telemetry Operating System — Architecture

## 🔥 Core Principle
**Splunk is called ONLY when user clicks Refresh**

Everything else reads from PostgreSQL cache.

---

## API Routes (Read: DB Only)
```
GET  /api/executive-summary    ← Main dashboard (gauges, tiers, savings, quick wins)
GET  /api/telemetry            ← Filterable index/sourcetype table
GET  /api/cache?key=...        ← Cache status (fresh/stale/error)
```

## Refresh Route (Write: Splunk → DB)
```
POST /api/cache
  ├─ Body: { mcpUrl, token, disableSslVerify, costPerGbPerDay }
  ├─ Behavior: BLOCKING (no polling)
  ├─ Flow:
  │   1. Check if refresh already running → 409 if yes
  │   2. Health-check Splunk (fail fast)
  │   3. Run aggregation pipeline (parallel agents)
  │   4. LLM scores all data (local-first strategy: gemma:2b → Anthropic fallback)
  │   5. Batch insert (50 rows per transaction)
  │   6. Return result when complete
  ├─ Timeout: 5 minutes (LLM processing)
  └─ Response: { success, snapshotId, inserted, errors, durationMs, agentReasoning }
```

---

## Data Flow

### On Load
```
Frontend
  ↓ (mount)
fetch('/api/executive-summary')  ← PostgreSQL read (fast, <100ms)
  ↓
Dashboard renders with cached data
```

### On User Refresh
```
User clicks "Refresh from Splunk"
  ↓
POST /api/cache { mcpUrl, token }
  ↓
Backend: SplunkClient → discover → metrics → sourcetypes
  ↓
Parallel agents (6x data fetch)
  ↓
LLM decision agent (gemma4:e4b) scores all
  ↓
Batch upsert to postgres (snapshot_id UUID versioning)
  ↓
Return { snapshotId, duration, agentReasoning }
  ↓
UI reload data from /api/executive-summary
```

---

## No-Go Zones

### ❌ Forbidden
- Polling every 2s (zero polling)
- Mock data (`Math.random()`, demo paths)
- Background jobs (no cron, no scheduled refresh)
- Splunk calls except in POST /api/cache

### ✅ Guaranteed
- Zero data fabrication
- One source of truth: PostgreSQL
- Explicit refresh control
- Deterministic (no race conditions)
- Atomic updates (all or nothing per snapshot_id)

---

## Database Schema

### telemetry_snapshots (primary)
Per refresh, stores index + sourcetype metrics with LLM decisions:
- `snapshot_id` UUID (versioning, rollback)
- `snapshot_date` DATE
- `index_name`, `sourcetype`, `granularity`
- Metrics: `daily_avg_gb`, `cost_per_year`, `risk_score`
- LLM output: `evidence` JSONB = { tier, action, compositeScore, reasoning, ... }

### executive_kpis (summary)
One row per snapshot, aggregate LLM output:
- `roiScore`, `gainScopeScore`, `totalLicenseSpend`, `storageSavingsPotential`
- `tierCounts` = { critical, important, niceToHave, lowValue }
- `quickWins` JSONB, `savingsStaircase` JSONB
- `agentReasoning` = executive LLM summary

### cache_metadata (staleness tracking)
- `status` = 'fresh' | 'stale' | 'error' | 'refreshing'
- `last_refresh_at` TIMESTAMPTZ
- `record_count` INTEGER

---

## LLM Integration

### Local-First Strategy
**Primary**: gemma:2b (Ollama, ~1.5-2GB RAM)
- **Cold start**: ~10 seconds; warm: ~2 seconds
- **Provider**: Ollama local

**Fallback**: Claude 3.5 Sonnet (Anthropic, requires ANTHROPIC_API_KEY)
- **Condition**: Triggered if Ollama unavailable or fails
- **Cost**: Per-token billing
- **Reliability**: Cloud-hosted, ~99.9% uptime

**Strict Data Integrity**: If no LLM available → dashboard returns error (no stale/mock data)

### Processing
- **Input**: Raw telemetry (index name, GB/day, events, utilization, cost)
- **Output**: JSON = { tier, action, scores, reasoning, flags }
- **Per-batch**: 20 inputs per LLM call (parallelized)
- **Timeout**: 180 seconds per batch

### Why Agentic?
No hardcoded rules. LLM decides tier (Critical/Important/Nice/Low) based on:
- Cost
- Utilization (daily query rate ÷ volume)
- Detection gaps (security coverage)
- Data quality (age, retention fit)
- Quick-win potential (high savings, low risk)

---

## UI Behavior

### Dashboard Tabs
1. **Overview**: Executive gauges, tier distribution, savings staircase, quick wins, gaps
2. **Telemetry Intelligence**: Expandable index table (per-row reasoning, scores, flags)

### Refresh Flow (Frontend)
```
1. User enters Splunk URL + token
2. Click "Refresh from Splunk"
3. Button → disabled + spinner
4. POST /api/cache (blocking)
5. Show progress hint: "Running LLM pipeline… up to 5min"
6. Response returns → resets button
7. Refetch /api/executive-summary
8. Toast: "✅ Refreshed in 23s"
```

---

## Next Steps (Post-MVP)

### Immediate
- [ ] Test end-to-end with Splunk + Ollama
- [ ] Load test batch insert (1M rows)
- [ ] Verify snapshot_id rollback behavior

### Future
- [ ] WebSocket for progress (no polling)
- [ ] Trend analysis (delta snapshots)
- [ ] Alert on detection gaps
- [ ] Field usage + search audit agents

---

## Critical Facts
- **0 polling**: No background refresh, no status checks
- **0 mock data**: All from real Splunk or error (strict data integrity)
- **1 LLM strategy**: Local-first (gemma:2b) → Cloud fallback (Anthropic)
- **No connection = No dashboard**: Enforced at routing layer
- **1 source of truth**: PostgreSQL
- **Blocking refresh**: 5min max, explicit trigger
- **Snapshot versioning**: rollback-safe UUID per refresh
