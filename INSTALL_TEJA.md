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
git checkout dev/dashboard-improvements   # the latest development branch

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

### Optional: prep a demo Splunk environment

If you want the same synthetic environment used for development, see
`scripts/env-prep/README.md`:

```bash
export SPLUNK_URL=https://<host>:8089 SPLUNK_USER=<admin> SPLUNK_PASSWORD=<pw>
node scripts/env-prep/run-all.mjs --dry-run   # preview
node scripts/env-prep/run-all.mjs             # build it
```

---

## 5. Reset to a clean slate

If telemetry looks stale or doubled (e.g. mixed runs):

```bash
node scripts/reset-demo-data.mjs --dry-run    # preview what clears
node scripts/reset-demo-data.mjs              # clear; preserves users/config/governance
```

Then Refresh again.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Must set GOVERNANCE_BOOTSTRAP_KEY` / `ADMIN_PASSWORD` on `up` | fill those in `.env` (they're required) |
| All scores 0 after a refresh | Splunk license is Free/expired — needs Enterprise; or no events in the last 24h |
| Worker keeps restarting | Postgres not healthy yet, or no active model pointer — check `docker compose logs worker` |
| `host.docker.internal` unreachable (Linux) | already mapped via `extra_hosts`; ensure Ollama listens on `0.0.0.0:11434` |
| Port 3002/5433 in use | change `WEB_PORT` / `POSTGRES_PORT` in `.env` |

See `KNOWN_ISSUES.md` for current limitations and `ROLLBACK_PLAN.md` if a
change misbehaves.
