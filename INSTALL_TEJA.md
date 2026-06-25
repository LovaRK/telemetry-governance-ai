# datasensAI — Install & Run (Teja)

Self-contained quickstart for running datasensAI on your own laptop against
your own Splunk. Full background lives in `README.md` and
`INSTALLATION_GUIDE.md`; this is the fast path.

---

## 0. Prerequisites

- **Docker Desktop** (Mac/Windows) or Docker Engine + compose (Linux)
- **Node.js 18+** (only needed to run the helper scripts, not the app itself)
- A reachable **Splunk Enterprise** instance you can point at (management
  port 8089). A Splunk *Free* license or an expired trial will index data but
  **blocks search-time commands**, so scores come back zero — use Enterprise.

---

## 1. Clone & configure

```bash
git clone <repo-url> datasensai
cd datasensai

git checkout main && git pull

cp .env.example .env
```

Edit `.env` and set, at minimum:

```bash
ADMIN_EMAIL=you@yourco.com
ADMIN_PASSWORD=<a strong password>

# generate each fresh:
#   openssl rand -hex 32
SPLUNK_SECRET_ENCRYPTION_KEY=<64 hex chars>
GOVERNANCE_BOOTSTRAP_KEY=<64 hex chars>
```

Leave the `NEXT_PUBLIC_SPLUNK_*` lines blank — you'll enter your Splunk
connection in the UI.

---

## 2. Choose an LLM path

**Path A — fully local (default, recommended).** Nothing leaves your machine.

```bash
# install Ollama (https://ollama.com), then:
ollama pull gemma2:9b
curl http://localhost:11434/api/tags     # should list gemma2:9b
```

The containers reach your host Ollama via `host.docker.internal` (the compose
file already maps this for Linux via `extra_hosts`).

**Path B — Anthropic fallback.** Only if your laptop can't run gemma2:9b. Set
`ANTHROPIC_API_KEY` in `.env`, then after first login go to **Settings → AI
Provider** and explicitly select Anthropic. There is **no silent fallback** —
local stays primary until you opt in.

---

## 3. Start

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

On first boot the web container runs migrations and creates your admin user.
Watch it come up:

```bash
docker compose --env-file .env -f docker/docker-compose.yml logs -f web | grep -E "Migration|Admin Init|ready"
```

Open **http://localhost:3002** and log in with the admin credentials from `.env`.

---

## 4. Connect Splunk & run

1. **Settings → Splunk Connection** — enter your management URL
   (`https://<host>:8089`), auth (Basic user:pass or a token), **Test
   Connection** until green, Save.
2. Back on the dashboard, click **Refresh** to run the pipeline:
   Splunk metadata → deterministic scoring → AI narrative → certification.
3. KPIs populate in ~1–3 minutes (LLM narrative runs in the background).

### Optional: prep a demo Splunk environment (DEMO/DEV ONLY)

> **⚠️ Skip this entire section if you're pointing the dashboard at a real
> production Splunk.** Your prod Splunk already has indexes and data; the
> worker auto-discovers them via `/services/data/indexes`. You do not need
> to upload 1stmile lookups or run env-prep for the dashboard to work.
>
> This section exists for the case where you want to populate a *fresh,
> empty Splunk* with the same 1stmile-shaped synthetic environment we use
> in dev — useful for demos and proof-of-concept walkthroughs against a
> throwaway Splunk instance. **Do not run env-prep against a production
> Splunk** — it will create/wipe the `datasense_demo` app, create demo
> indexes, and inject synthetic events.

If you understand the above and want the dev/demo environment in your own
fresh Splunk, see `scripts/env-prep/README.md`:

```bash
export SPLUNK_URL=https://<host>:8089 SPLUNK_USER=<admin> SPLUNK_PASSWORD=<pw>
node scripts/env-prep/run-all.mjs --dry-run   # preview, change nothing
node scripts/env-prep/run-all.mjs             # actually create demo data
```

The script: (1) creates demo indexes (oswin, apptomcat, appapache…),
(2) injects ~0.25 GB of synthetic events proportional to the 1stmile
profile, (3) uploads the 1stmile volume CSV as a Splunk lookup the
worker can query for normalised daily-GB values, (4) creates saved
searches, macros, and ad-hoc usage to simulate analyst activity.

---

## 5. Reset to a clean slate

If telemetry looks stale or doubled (e.g. mixed runs):

```bash
node scripts/reset-demo-data.mjs --dry-run    # preview what clears
node scripts/reset-demo-data.mjs              # clear; preserves users/config/governance
```

Then Refresh again.

---

## Verify it's pulling from YOUR Splunk

After a successful Refresh, your dashboard's index names + GB totals are
discovered live from your Splunk — there is no hardcoded index list anywhere.
Confirm with two checks:

```bash
# Indexes the worker pulled from /services/data/indexes on your instance:
docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -c "
  SELECT index_name, daily_avg_gb, retention_days, classification
  FROM telemetry_snapshots
  WHERE snapshot_id = (SELECT snapshot_id FROM pipeline_runs WHERE status='SUCCEEDED' ORDER BY started_at DESC LIMIT 1)
  ORDER BY daily_avg_gb DESC;"

# Total daily ingest across all indexes:
docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -c "
  SELECT SUM(daily_avg_gb)::numeric(10,2) AS total_daily_gb, COUNT(*) AS index_count
  FROM telemetry_snapshots
  WHERE snapshot_id = (SELECT snapshot_id FROM pipeline_runs WHERE status='SUCCEEDED' ORDER BY started_at DESC LIMIT 1);"
```

The `index_name` column should match what `| metadata type=indexes` returns
in your Splunk Search head. If you have the `1stmile_index_sourcetype_and_source_volume_lookupcsv`
lookup uploaded (env-prep step `05b`), the per-index GB is normalised to the
Teja-confirmed 92 GB/day baseline — otherwise it's read from `currentDBSizeMB
/ retentionDays`.

---

## Pipeline guarantees (updated 2026-06-24)

The pipeline now survives long Ollama runs. Specifics:

| Guarantee | How it works |
|---|---|
| **20+ min pipeline runs don't fail with "idle timeout"** | Worker emits a `HEARTBEAT` stage event after every batch; `cache-status` polls treat HEARTBEAT as activity |
| **No more "Pipeline worker lease expired" after 5 min** | Lease window is 25 min, stale-job recovery uses `heartbeat_at` (refreshed per batch) instead of `started_at` (set once) |
| **No more "OLLAMA_UNREACHABLE" while a batch is running** | LLM readiness probe uses `/api/tags` (non-blocking) instead of `/api/generate` (queues behind active inference) |
| **No more forced logout during long pipeline runs** | Single-flight token refresh in `apps/web/lib/api-client.ts`; access-token TTL raised from 15 min → 1 h |
| **Total daily ingest reports ~92 GB on the 1stmile profile** | Worker queries the customer-profile volume lookup; falls back to physical metadata when absent |

If you previously hit any of these symptoms, pull `main` and rebuild the
`worker` + `web` images.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Must set GOVERNANCE_BOOTSTRAP_KEY` / `ADMIN_PASSWORD` on `up` | fill those in `.env` (they're required) |
| All scores 0 after a refresh | Splunk license is Free/expired — needs Enterprise; or no events in the last 24h |
| Worker keeps restarting | Postgres not healthy yet, or no active model pointer — check `docker compose logs worker` |
| `host.docker.internal` unreachable (Linux) | already mapped via `extra_hosts`; ensure Ollama listens on `0.0.0.0:11434` |
| Port 3002/5433 in use | change `WEB_PORT` / `POSTGRES_PORT` in `.env` |
| Pipeline fails at AI Decisions stage | Verify Ollama running: `curl http://localhost:11434/api/tags`. If on Anthropic, check API key in **Settings → AI Provider**. |
| Dashboard shows old values after Refresh | Hard-reload the browser (Cmd/Ctrl + Shift + R). If still stale, check the latest published run: `SELECT run_id, snapshot_id, published, started_at FROM pipeline_runs ORDER BY started_at DESC LIMIT 3;` |
| Bounced to /login mid-Refresh | Hard reload + log back in. Fixed in v1.2.0 (`main`) — older builds had a token-refresh race condition. |

See `KNOWN_ISSUES.md` for current limitations and `ROLLBACK_PLAN.md` if a
change misbehaves.
