# datasensAI — Agentic Telemetry Dashboard

AI-powered Splunk telemetry optimisation dashboard. The LLM analyses every index, assigns tiers and actions, and explains its reasoning on every metric.

---

## Quick Start

### Prerequisites
- **Docker Desktop** (v24+)
- **Git**

### One-command bootstrap

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

This script:
1. Verifies Docker is running
2. Starts PostgreSQL and applies the schema automatically
3. Starts Ollama (local LLM server)
4. Pulls the `gemma4:e4b` model (or `gemma:2b` as fallback) — first run may take a few minutes
5. Starts the Next.js web application
6. Confirms all services are healthy and prints the dashboard URL

After the script completes, open **http://localhost:3002**.

---

## First Use

1. Open http://localhost:3002
2. Enter your **Splunk URL** and **HEC/API token** on the setup screen
3. Click **Refresh** — this triggers the full pipeline:
   - Fetch index metrics from Splunk REST API
   - Process into telemetry signals
   - Send to local Gemma LLM for decisions (tier, action, reasoning)
   - Store all decisions in PostgreSQL
   - Dashboard populates automatically

---

## Architecture

```
Splunk REST API
    ↓
Backend (Node.js)
    ↓  fetch index metrics, sourcetype breakdown, saved searches
Local LLM (Ollama/gemma4:e4b)
    ↓  classify each index: tier, action, confidence, evidence
PostgreSQL
    ↓  telemetry_snapshots, executive_kpis, agent_decisions
Next.js Dashboard
    ↓  reads from DB only (never calls Splunk on load)
```

**No mock data. No hardcoded decisions.** All data flows from Splunk through the LLM into PostgreSQL and is displayed in the dashboard.

---

## LLM Decision Layer

- **Default:** Ollama with `gemma4:e4b` (fully local, no API key required)
- **Optional cloud fallback:** Set `ANTHROPIC_API_KEY` in `docker/.env` to enable Claude as fallback when Ollama is unavailable
- The LLM is the **sole decision maker** — no rule-based scoring in code

---

## Dashboard Features

### Executive Overview
- **Clickable gauges** — click any metric to see exactly how the LLM calculated it
- **Clickable scatter plot** — click any bubble to see that index's full reasoning
- **Clickable savings staircase** — click any bar to see which indexes drive savings at that stage
- **Clickable quick wins** — click any row for full LLM recommendation
- **Section explainers** — "How was this calculated?" toggle on every section

### Telemetry Detail (/detail)
- Sourcetype health board with tier badges
- Security/quality/retention analysis tables
- Search audit — orphan and unused saved searches
- Decision Timeline showing LLM reasoning stages

---

## Docker Services

| Service | Port | Description |
|---------|------|-------------|
| Web (Next.js) | 3002 | Dashboard UI + API routes |
| Ollama | 11434 | Local LLM server |
| PostgreSQL | 5433 | Decision store |

```bash
# View logs
docker-compose -f docker/docker-compose.yml logs -f

# Stop all services
docker-compose -f docker/docker-compose.yml down

# Full reset (destroys DB data)
docker-compose -f docker/docker-compose.yml down -v
```

---

## Environment Variables

Copy `docker/.env.example` to `docker/.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `SPLUNK_URL` | Optional* | Splunk base URL (can be set in UI) |
| `SPLUNK_TOKEN` | Optional* | Splunk API token (can be set in UI) |
| `ANTHROPIC_API_KEY` | No | Enables Claude as cloud LLM fallback |
| `DATABASE_URL` | Auto-set | PostgreSQL connection string |

*Can be configured from the UI setup screen on first launch.
