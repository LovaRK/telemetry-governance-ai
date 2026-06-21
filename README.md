# datasensAI — Splunk Telemetry Intelligence Platform

A mono-repo application that analyzes Splunk telemetry data to score every
sourcetype on Utilization, Detection, and Quality — then surfaces dollar-impact
recommendations through an executive dashboard.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Splunk Enterprise (customer instance or mock)              │
│  REST API / MCP on port 8089                                │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Docker Stack                                               │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐ │
│  │ web:3002 │  │ worker    │  │ postgres │  │ splunk-   │ │
│  │ (Next.js)│  │ (ts-node) │  │          │  │ mock:18089│ │
│  │ API+UI   │  │ LLM agent │  │          │  │ (dev only)│ │
│  └──────────┘  └───────────┘  └──────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Deterministic-first design:** The scoring engine computes all scores and tiers.
The local LLM (Ollama gemma2:9b) only writes the human-readable narrative. The
worker overwrites any LLM-emitted score with the deterministic value before
persisting — no LLM drift.

## Mono-repo Structure

```
├── apps/
│   ├── api/              # Backend services (scoring engine, aggregation, Splunk queries)
│   │   ├── services/     # Business logic (deterministic-scoring-engine, aggregation, splunk)
│   │   ├── routes/       # API route handlers
│   │   ├── middleware/    # Auth, CORS, rate limiting
│   │   └── migrations/   # Database migrations
│   ├── web/              # Frontend (Next.js 14, App Router)
│   │   ├── app/          # Pages and API routes
│   │   ├── components/   # React components (dashboard/, layout/)
│   │   ├── lib/          # Shared utilities (types, API client, auth)
│   │   └── hooks/        # React hooks
│   └── core/             # Shared app-level utilities
├── packages/
│   ├── auth/             # Authentication (JWT, RBAC, request context)
│   └── core/             # Shared domain logic
│       └── engine/       # Scoring + savings computation
│           ├── scoring/  # Utilization, Detection, Quality, Composite, Tier
│           └── savings/  # Storage cost savings engine (guide §8)
├── core/                 # Infrastructure (database, security, observability)
│   ├── database/         # PostgreSQL connection, queries
│   └── security/         # Environment validation, encryption
├── agents/               # LLM agent definitions
├── docker/               # Docker Compose, worker entrypoint
│   ├── docker-compose.yml
│   └── worker.ts         # Background job processor (LLM + KPI aggregation)
├── tools/                # Development tooling
│   └── sandbox/          # Mock Splunk server for development
├── scripts/              # Utility scripts (env prep, data seeding)
└── tests/                # Contract and integration tests
    └── contract/         # Formatter and savings engine contract tests
```

## Quick Start

### Prerequisites

- **Docker Desktop** (Mac/Windows) or Docker Engine + Compose (Linux)
- **Ollama** with `gemma2:9b` pulled (`ollama pull gemma2:9b`)
- A **Splunk Enterprise** instance (optional — mock server included for dev)

### Setup

```bash
git clone <repo-url> datasensai && cd datasensai
cp .env.example .env
```

Edit `.env`:

```bash
ADMIN_EMAIL=you@yourco.com
ADMIN_PASSWORD=<strong-password>
SPLUNK_SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)
GOVERNANCE_BOOTSTRAP_KEY=$(openssl rand -hex 32)
```

### Run

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Open http://localhost:3002, log in, configure Splunk in Settings, click **Refresh**.

### Verify

```bash
# Contract tests (formatter + savings engine)
npx jest tests/contract/ --no-coverage

# Health check
curl -s http://localhost:3002/api/health
```

## Key Screens

| Screen | Route | Description |
|---|---|---|
| Executive Overview | `/` | ROI, GainScope, Savings gauges; tier distribution; savings staircase |
| Detail Analysis | `/detail` | Per-index scoring breakdown; Resolution Confidence; Field Usage |
| Storage Cost | `/storage-cost` | Per-index storage cost ranking with savings breakdown |
| Governance | `/governance` | Review queue; approve/reject recommendations |
| Settings | `/settings` | Splunk connection; AI provider; user management |

## Scoring Methodology

All formulas are implemented from `datasensAI_calculation_guide.pdf`:

| Score | Formula | File |
|---|---|---|
| Utilization | Weighted sum of alerts, searches, dashboards, ad-hoc, users (0–100) | `packages/core/engine/scoring/utilization.ts` |
| Detection | `0.40 × potential + 0.60 × realized` (MITRE + Lantern) | `packages/core/engine/scoring/detection.ts` |
| Quality | `max(0, 100 − issue_density × 2000)` | `packages/core/engine/scoring/quality.ts` |
| Composite | `U×Wu + D×Wd + Q×Wq` (default weights 0.35/0.40/0.25) | `packages/core/engine/scoring/composite.ts` |
| Tier | Critical ≥65, Important ≥40, Nice-to-Have ≥20, Low-Value <20 | `packages/core/engine/tier.ts` |
| Storage Savings | Retention excess + compression opportunity × $/GB/month | `packages/core/engine/savings/storage.ts` |

## LLM Policy

- **Default:** Local Ollama `gemma2:9b` — nothing leaves your machine
- **Optional:** Anthropic API — only when explicitly selected in Settings and API key entered
- **Never:** Auto-fallback to Anthropic

## Documentation

| Document | Purpose |
|---|---|
| [INSTALL_TEJA.md](INSTALL_TEJA.md) | Detailed install + run guide |
| [HANDOVER_DATASENSAI.md](HANDOVER_DATASENSAI.md) | Verified parity matrix, what works, what's blocked |
| [HANDOFF_CHECKLIST.md](HANDOFF_CHECKLIST.md) | Day-1 checklist for new operator |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Known limitations and workarounds |
| [TESTING.md](TESTING.md) | Test strategy and commands |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment guide |

## Development

The web container hot-reloads `apps/web/` and `apps/api/` changes. The worker
bakes source at build time — rebuild after editing `docker/worker.ts`:

```bash
GOVERNANCE_BOOTSTRAP_KEY=<key> ADMIN_PASSWORD=<pw> SPLUNK_SECRET_ENCRYPTION_KEY=<key> \
  docker compose build worker && docker compose up -d worker
```

### Running Tests

```bash
npx jest tests/contract/              # Contract tests (19 tests)
npx jest tests/ --no-coverage         # All tests
```
