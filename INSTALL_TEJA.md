# datasensAI — Install & Run (Teja)

Self-contained quickstart for running datasensAI on your own laptop against
your own Splunk.

**v1.3.0 installer:** double-click to get a guided menu. No terminal needed.
The installer auto-generates credentials, verifies login before reporting
success, and saves a `credentials.txt` file.

---

## 0. Prerequisites

- A reachable **Splunk Enterprise** instance (management port 8089). A Splunk
  *Free* license or an expired trial blocks search-time commands, so scores
  come back zero — use Enterprise.
- 20 GB free disk, 8 GB RAM (16 GB recommended for the AI model)
- The installer handles everything else (Docker, Homebrew, Ollama, etc.)

---

## 1. Get the installer

```bash
git clone https://github.com/LovaRK/telemetry-governance-ai.git datasensai
cd datasensai
git checkout fix/layman-friendly-installer && git pull
```

---

## 2. Run the installer

**Mac:** double-click `scripts/install/Install datasensAI.command` in Finder.
Or in a terminal:

```bash
cd scripts/install && chmod +x install.sh && ./install.sh
```

**Windows:** double-click `scripts\install\Install datasensAI.bat`.
It triggers UAC (click Yes) and opens the menu.

The installer shows a menu:

```
1) Fresh install      ← choose this on first run
2) Start existing
3) Repair install
4) Reset/reinstall
5) Export support logs
6) Stop app
7) Uninstall
```

Choose **1 — Fresh install**. The installer will:
- Install Docker, Homebrew, Ollama if missing
- Auto-generate secure admin credentials (no password typing needed)
- Download the AI model (~5 GB, takes 10-30 min)
- Start all containers and run database migrations
- **Verify login via the API before showing "complete"**
- Save your credentials to `~/datasensai/credentials.txt`
- Open the browser automatically

---

## 3. After install: connect your Splunk

1. Log in with credentials from `~/datasensai/credentials.txt`
2. **Settings → Splunk Connection** — enter your Splunk URL (`https://<host>:8089`)
3. Enter auth (username + password, or a Splunk token)
4. Click **Test Connection** until green, then Save
5. Back on the dashboard, click **Refresh**
   (first pipeline run: 20-25 min — AI analysis runs in background)

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

Run the doctor first:

```bash
# Mac/Linux
~/datasensai/scripts/install/doctor.sh

# Windows (Admin PowerShell)
%USERPROFILE%\datasensai\scripts\install\doctor.ps1
```

| Symptom | Fix |
|---|---|
| Can't find credentials / forgot password | Check `~/datasensai/credentials.txt` (Mac) or `%USERPROFILE%\datasensai\credentials.txt` (Windows). If missing, run the installer → **Repair install** — it auto-resets the admin password. |
| Installer says "Login API FAILED" | Run installer → **Repair install** — it resets the password via bcrypt in the DB then re-verifies. |
| All scores 0 after a refresh | Splunk license is Free/expired — needs Enterprise; or no events in the last 24h |
| Worker keeps restarting | Postgres not healthy yet — wait 2 min and check `docker logs docker-worker-1` |
| `host.docker.internal` unreachable (Linux) | Already mapped via `extra_hosts`; ensure Ollama listens on `0.0.0.0:11434` |
| Port 3002/5433 in use | Change `WEB_PORT` / `POSTGRES_PORT` in `.env` then run installer → **Repair install** |
| Pipeline fails at AI Decisions stage | Run `curl http://localhost:11434/api/tags`. If Ollama is down, run `ollama serve`. If using Anthropic, check API key in **Settings → AI Provider**. |
| Dashboard shows old values after Refresh | Hard-reload the browser (Cmd/Ctrl + Shift + R). |
| Bounced to /login mid-Refresh | Hard reload + log back in. Fixed in v1.2.0 (main). |
| Something else broken | Run `scripts/install/export-logs.sh` (Mac) or `export-logs.ps1` (Windows) and share the ZIP. |

See `KNOWN_ISSUES.md` for current limitations and `ROLLBACK_PLAN.md` if a
change misbehaves.
