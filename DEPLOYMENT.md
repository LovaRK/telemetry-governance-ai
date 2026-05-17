# Deployment Models — Web-Only vs Full-Stack

**Last Updated:** 2026-05-17  
**Status:** Production Ready

---

## Overview

The dashboard supports two deployment models:

1. **Web-Only Build** — Standalone frontend (Next.js) without database/API layer
2. **Full-Stack Deployment** — Frontend + Backend (Node.js API routes) + PostgreSQL + Ollama

### When to Use Each

| Aspect | Web-Only | Full-Stack |
|--------|----------|-----------|
| **Use Case** | Demos, static dashboards, frontend development | Production, Splunk integration, LLM decisions |
| **Data Source** | Mock/in-memory config | PostgreSQL + Ollama LLM |
| **Splunk Integration** | None | Full Splunk REST API queries |
| **LLM Decisions** | Stubbed (503) | Real gemma4:e4b or fallback Anthropic |
| **Setup Time** | < 1 minute | 5-10 minutes (Docker pulls) |
| **Infrastructure** | Single machine, no Docker | Docker Compose (Postgres + Ollama + Next.js) |
| **Dependencies** | Node.js 18+ | Docker, 16GB RAM (Ollama) |

---

## Web-Only Build

### What It Is

A Next.js frontend-only deployment that:
- ✅ Renders the dashboard UI and components
- ✅ Shows demo data and example visualizations
- ✅ Allows navigation between pages
- ✅ Returns graceful 503 responses for unavailable features
- ✅ Works on a single machine with just Node.js

### What's Unavailable

All features requiring PostgreSQL or Splunk API:
- Secondary table data (field usage, security coverage, quality hotspots)
- Search audit (saved search analysis)
- Real LLM decisions (endpoints return 503)
- Health checks
- Telemetry queries
- Agent decision history
- Bulk actions

### How to Build

```bash
cd apps/web
npm run build
npm run start  # Starts on http://localhost:3002
```

Or for development:

```bash
cd apps/web
npm run dev
```

### Stubbed API Endpoints

When called, these return 503 Service Unavailable with guidance to use full-stack deployment:

```
GET  /api/executive-summary
GET  /api/health
GET  /api/field-usage
GET  /api/search-audit
GET  /api/quality-hotspots
GET  /api/agent-decisions
GET  /api/security-coverage
POST /api/bulk-actions
GET  /api/decision-history
GET  /api/telemetry
```

### Available Endpoints

```
GET  /api/config              (200) — in-memory config with defaults
GET  /api/cache-status        (200) — returns "unavailable" status
```

### Frontend Behavior

The dashboard detects unavailable endpoints gracefully:

1. **Connection Gating:** Checks `/api/cache-status` on mount
2. **Fallback Display:** Shows "Configure Splunk" banner if no data
3. **Component Behavior:** Detail page tables display empty with "(unavailable in web-only build)" message
4. **Error Handling:** API 503 responses are caught and logged, not breaking the UI

---

## Full-Stack Deployment

### What It Is

Complete production deployment with:
- ✅ Next.js frontend + Node.js API layer
- ✅ PostgreSQL database for decision storage
- ✅ Ollama LLM server (local gemma4:e4b or gemma2:9b)
- ✅ Full Splunk integration via REST API
- ✅ Real LLM decision making and audit trail

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Browser                              │
│                 (Dashboard UI, forms)                        │
└──────────────────────────────────────────────────────────────┘
                          ↓↑
┌──────────────────────────────────────────────────────────────┐
│               Next.js Web Application                         │
│              (apps/web, port 3002)                           │
│  - Server-side API routes (apps/web/app/api/*)             │
│  - Client components (apps/web/components/*)                │
│  - Static pages and detail views                            │
└──────────────────────────────────────────────────────────────┘
         ↓↑                        ↓↑                   ↓↑
┌─────────────────┐   ┌──────────────────────┐   ┌──────────────┐
│  Splunk REST    │   │   PostgreSQL         │   │   Ollama     │
│  API (user      │   │  (decision store,    │   │   (LLM       │
│  configured)    │   │   audit trail)       │   │   inference) │
└─────────────────┘   └──────────────────────┘   └──────────────┘
```

### How to Deploy

#### Option 1: Bootstrap Script (Recommended)

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

This script:
1. Checks Docker is running
2. Pulls postgres and ollama images
3. Starts PostgreSQL with health checks
4. Starts Ollama and downloads model
5. Starts the Next.js app
6. Prints dashboard URL when ready

#### Option 2: Manual Docker Compose

```bash
docker-compose -f docker/docker-compose.yml up
```

Services:
- **web** (3002): Next.js app
- **postgres** (5433): PostgreSQL 15
- **ollama** (11434): Ollama LLM server

### First Use

1. Open http://localhost:3002
2. Configure Splunk credentials (URL + API token)
3. Click **Refresh** to start pipeline:
   - Fetch index metrics from Splunk
   - Process into telemetry signals
   - Send to Ollama for decisions
   - Store in PostgreSQL
   - Dashboard auto-populates

### API Endpoints (Full Responses)

All endpoints return real data from PostgreSQL:

```
GET  /api/executive-summary      — KPIs, quick wins, staircase
GET  /api/agent-decisions         — LLM decisions with reasoning
GET  /api/security-coverage       — MITRE coverage per sourcetype
GET  /api/field-usage             — Indexed vs used field stats
GET  /api/search-audit            — Orphan/unused saved searches
GET  /api/quality-hotspots        — Parse error rates per sourcetype
GET  /api/health                  — System health (DB, migrations)
GET  /api/config                  — User configuration
GET  /api/cache-status            — Last refresh status
POST /api/bulk-actions            — Bulk operations (Archive, etc.)
GET  /api/decision-history        — Audit trail of decision changes
GET  /api/telemetry               — Snapshots with filtering
```

---

## Migration Path: Web-Only → Full-Stack

If you start with web-only and want to upgrade:

1. Install Docker and Docker Compose
2. Run `./scripts/bootstrap.sh`
3. Configure your Splunk credentials in the UI
4. Click **Refresh** — the system automatically populates the database
5. All previously-stubbed endpoints now return real data

No code changes required. The same frontend works for both deployments.

---

## Environment Variables

### Web-Only Build

```bash
NODE_ENV=production  # or development
```

### Full-Stack Build

```bash
# .env file in docker/
DATABASE_URL=postgresql://...
OLLAMA_BASE_URL=http://ollama:11434
LLM_MODEL=gemma4:e4b              # or gemma2:9b
ANTHROPIC_API_KEY=...             # Optional fallback
SPLUNK_URL=https://your-splunk
SPLUNK_API_TOKEN=...
```

---

## Troubleshooting

### Web-Only: "API endpoints returning 503"
**Expected behavior.** These are stubbed for the web-only build. The UI handles them gracefully.

### Full-Stack: Ollama OOM (Out of Memory)
```bash
# Reduce batch size in .env
MAX_PARALLEL=1
```

Or use `gemma2:9b` instead of `gemma4:e4b` (requires <16GB).

### Full-Stack: PostgreSQL connection refused
```bash
# Check Docker service
docker ps | grep postgres

# View logs
docker-compose -f docker/docker-compose.yml logs postgres
```

### Full-Stack: Dashboard shows "Configure Splunk" after setting credentials
- Verify credentials are valid
- Check `/api/cache-status` returns hasEverRefreshed: true
- Click **Refresh** button to trigger pipeline

---

## Production Considerations

### Scalability

- **Indexes per snapshot:** Currently batched at 5 per LLM prompt
- **Concurrent Splunk queries:** MAX_PARALLEL=2 (Ollama constraint)
- **Database:** Single PostgreSQL instance supports 100k+ index decisions
- **Frontend:** Handles 1000+ rows in detail tables (virtualized rendering optional)

### Reliability

- **Pipeline failures:** Non-fatal (individual batch failures don't halt snapshot)
- **LLM fallback:** Automatic to Anthropic API on Ollama timeout (if ANTHROPIC_API_KEY set)
- **Database backups:** Use `docker-compose exec postgres pg_dump ...`
- **Model persistence:** Ollama models stored in Docker volume (survives restart)

### Security

- **Splunk credentials:** Stored in environment variables, never in code
- **API tokens:** PostgreSQL stores raw tokens (consider encryption at rest in production)
- **LLM data:** Stays local if using Ollama, sent to Anthropic only on fallback
- **No mock data:** All visualizations are backed by real Splunk queries

---

## File Structure by Deployment

### Web-Only
```
apps/web/
├── app/
│   ├── api/                    ← Stubbed routes
│   ├── page.tsx                ← Home (works)
│   ├── detail/page.tsx         ← Detail (works, no data)
├── components/                 ← All UI (works)
├── public/
└── package.json
```

### Full-Stack
```
docker/
├── docker-compose.yml          ← Orchestrates all services
├── .env                        ← Splunk + LLM config
├── infrastructure/
│   └── schema.sql              ← Database schema
apps/
├── web/
│   ├── app/api/                ← All routes active
│   ├── components/
├── api/                        ← Node.js backend (optional, for API-only use)
```

---

## Decision Log

**Why two deployment models?**

During Phase 3 build stabilization, we discovered that the web-only build cannot import from `@core/database` or `@api` layers due to Next.js 14 module resolution constraints. Rather than work around this, we embraced it:

- Web-only serves demos, frontend testing, and education
- Full-stack serves production with real data
- Clean separation of concerns (no hacky conditional imports)
- Both use identical UI/component code

**Why stub with 503 instead of returning empty arrays?**

- 503 signals "service temporarily unavailable, full deployment needed"
- Empty arrays silently fail (silent failure is worse than loud failure)
- Helps debugging: you immediately know "this needs full-stack"
- UI handles 503 gracefully (logs warning, shows appropriate message)
