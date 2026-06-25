# datasensAI Installer v1.3.0

Guided, validation-gated installation wizard for Mac, Windows, and Linux.

**The installer does NOT show "Installation complete" until the login API
returns a valid JWT using the generated credentials.** Every step is
verified before the next one begins.

---

## Quick start

### Mac / Linux

Double-click **`Install datasensAI.command`** in Finder.

Or from a terminal:

```bash
cd scripts/install
chmod +x install.sh doctor.sh export-logs.sh
./install.sh
```

### Windows

Double-click **`Install datasensAI.bat`** in Explorer.
It triggers a UAC prompt (click Yes) and launches the guided menu.

Or from an **Administrator** PowerShell window:

```powershell
cd scripts\install
.\install.ps1
```

---

## Menu options

When you run the installer, a menu appears:

| Option | What it does |
|--------|-------------|
| **1. Fresh install** | Downloads code, generates config, starts stack, verifies everything end-to-end |
| **2. Start existing** | Starts existing containers and opens browser |
| **3. Repair install** | Restarts containers, re-verifies login (auto-repairs credential mismatches) |
| **4. Reset / reinstall** | WIPES database + config, then runs fresh install |
| **5. Export support logs** | Creates a ZIP bundle for sharing with support |
| **6. Stop app** | Stops containers (data is preserved) |
| **7. Uninstall** | Removes containers, volumes, and the install folder |

---

## What the installer does (fresh install flow)

1. Checks OS, disk space (>= 20 GB), RAM (>= 8 GB warning)
2. Installs missing tools: Git, Homebrew (Mac), Docker Desktop
3. Starts Docker daemon (waits up to 3 minutes)
4. Checks ports 3002 (web), 5433 (postgres), 11434 (Ollama) are free
5. Clones / updates the repo to `~/datasensai`
6. **Auto-generates** secure admin credentials and writes `.env` with random secrets
7. Installs Ollama and pulls `gemma2:9b` (~5 GB)
8. Runs `docker compose up -d --build`
9. Waits for postgres to become `healthy`
10. Waits for the web app to respond, then checks `GET /api/health` for `schema.valid: true` and `latestMigration: 213`
11. Confirms the admin user was seeded in the database
12. **Posts to `POST /api/auth/login`** — only shows "complete" if this returns an `accessToken`
13. Verifies the dashboard URL responds
14. Writes verified credentials to `~/datasensai/credentials.txt`
15. Opens the browser

---

## Credentials

Credentials are **auto-generated** — you do not need to choose a password.

After a successful install, find them at:
- **Mac/Linux:** `~/datasensai/credentials.txt`
- **Windows:** `%USERPROFILE%\datasensai\credentials.txt`

The file is only created after Step 12 (login verified). If `credentials.txt`
does not exist, the install did not fully complete.

### Advanced mode (custom credentials)

Mac/Linux:
```bash
ADVANCED_SETUP=1 ./install.sh
```

Windows:
```powershell
.\install.ps1 -AdvancedSetup
```

This shows prompts for admin email and an optional custom password (still
auto-generates if you press Enter).

---

## Repair mode

If something breaks after initial install (e.g. credentials lost, container
crashed), run the installer and choose **Repair install**. It will:

1. Restart containers
2. Verify the login API
3. If login fails, automatically reset the admin password in the database
   using `bcryptjs` inside the web container, then re-verify

After repair, `credentials.txt` is updated with working credentials.

---

## Support logs

To share logs with support:

**Mac/Linux:**
```bash
./export-logs.sh
```

**Windows:**
```powershell
.\export-logs.ps1
```

This creates a ZIP on your Desktop containing:
- Installer logs
- Redacted `.env` (passwords and keys are replaced with `[REDACTED]`)
- Container logs (postgres, web, worker — last 300 lines)
- `docker info`, `docker ps`, API health response
- Port usage and version info

---

## Doctor (health check)

Run at any time to see the full status:

**Mac/Linux:**
```bash
./doctor.sh
```

**Windows:**
```powershell
.\doctor.ps1
```

Doctor checks: OS, disk, Docker, containers, schema validity, migration number,
**login API**, Splunk connection status, credentials file.

Exit code 0 = all green. Exit code 1 = one or more failures.

---

## Non-interactive / scripted use

Mac/Linux environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET_DIR` | `~/datasensai` | Where to install |
| `WEB_PORT` | `3002` | App port |
| `POSTGRES_PORT` | `5433` | Postgres port |
| `OLLAMA_PORT` | `11434` | Ollama port |
| `LLM_MODEL` | `gemma2:9b` | Ollama model to pull |
| `MODE` | _(menu)_ | `fresh` \| `start` \| `repair` \| `reset` \| `logs` \| `stop` \| `uninstall` |
| `ADVANCED_SETUP` | `0` | `1` = show credential prompts |

```bash
MODE=fresh TARGET_DIR=/opt/datasensai ./install.sh
```

Windows parameters: same names as PowerShell params (`-Mode`, `-TargetDir`, etc.).
