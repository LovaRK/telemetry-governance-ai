# datasensAI installer

Two ways to install datasensAI on a fresh laptop. Pick whichever you prefer.

## On Mac (M-series or Intel)

**Easy path** — double-click `Install datasensAI.command`. macOS opens
Terminal automatically, the installer runs, you answer a few prompts.

**Terminal path** — same script, manual invocation:

```bash
cd scripts/install
./install.sh
```

## On Windows 10 / 11

**Easy path** — double-click `Install datasensAI.bat`. Windows shows a UAC
prompt (click Yes), an elevated PowerShell window opens, the installer runs.

**PowerShell path** — right-click PowerShell → Run as Administrator, then:

```powershell
cd scripts\install
.\install.ps1
```

## What the installer does (in order)

1. **Host checks** — OS, admin rights, ≥ 20 GB free disk, ≥ 8 GB RAM (warns
   if < 16 GB)
2. **Git** — installs via Xcode CLT (Mac) / winget (Windows) / apt-get
   (Linux) if missing
3. **Docker Desktop** — installs if missing; waits for the daemon to come up
4. **Ollama + gemma2:9b** — installs Ollama, pulls the 5 GB model (this is
   the slow step; takes ~10 min on a normal connection)
5. **Clones the repo** to `~/datasensai` (Mac/Linux) or `%USERPROFILE%\datasensai` (Windows)
6. **Generates `.env`** — two `openssl rand -hex 32` secrets, prompts for
   your admin email + password
7. **`docker compose up -d --build`** — first build takes ~3 min
8. **Waits for `/api/health`** on `:3002`
9. **Prints the URL + admin creds + next steps**

Total time on a clean machine: **15-25 minutes**. Re-running on a
machine that already has Docker + Ollama: **2-3 minutes**.

## Configuration overrides

Pass these as env vars (Mac/Linux) or PowerShell parameters (Windows):

| Variable / Parameter | Default | Effect |
|---|---|---|
| `REPO_URL` / `-RepoUrl` | the LovaRK repo | Use a fork or private mirror |
| `BRANCH` / `-Branch` | `main` | Pull a specific branch (useful for testing PRs) |
| `TARGET_DIR` / `-TargetDir` | `~/datasensai` | Install into a different directory |
| `LLM_MODEL` / `-LlmModel` | `gemma2:9b` | Use a different Ollama model (`llama3.2:3b` for low-RAM machines) |
| `WEB_PORT` / `-WebPort` | `3002` | Bind the dashboard to a different port |
| `QUIET` / `-Quiet` | unset | Accept defaults on non-essential prompts |

Examples:

```bash
# Mac/Linux: install a specific PR branch into a different folder
BRANCH=feature/2026-06-24-tejas-install-pipeline-fixes \
  TARGET_DIR=$HOME/datasensai-pr \
  ./install.sh

# Windows: same idea
.\install.ps1 -Branch feature/2026-06-24-tejas-install-pipeline-fixes `
              -TargetDir $env:USERPROFILE\datasensai-pr
```

## When something looks wrong

Run the doctor. It checks every component independently and prints a
single coloured report:

```bash
# Mac/Linux:
./doctor.sh

# Windows:
.\doctor.ps1
```

Output looks like:

```
Host
  ✓  OS: Darwin arm64
  ✓  Disk: 166 GB free in /Users/you

Tooling
  ✓  Git: 2.50.1
  ✓  Docker daemon running: 29.4.0
  ✓  openssl: OpenSSL 3.6.2

LLM (Ollama)
  ✓  Ollama service responding on :11434
  ✓  Models loaded: gemma2:9b
  ✓  Default model gemma2:9b present

Repo
  ✓  Repo at ~/datasensai
  ✓  Branch: main @ abc1234
  ✓  .env present
  ✓  .env ADMIN_EMAIL set
  ✓  .env ADMIN_PASSWORD set
  ✓  .env SPLUNK_SECRET_ENCRYPTION_KEY set
  ✓  .env GOVERNANCE_BOOTSTRAP_KEY set

App stack
  ✓  Container docker-postgres-1: Up (healthy)
  ✓  Container docker-web-1: Up (healthy)
  ✓  Container docker-worker-1: Up
  ✓  Dashboard responding on http://localhost:3002

Splunk (tenant config in DB)
  !  Default tenant has no Splunk URL configured yet
     (Settings → Splunk Connection)

Summary: 15 ✓  1 !  0 ✗
```

Anything `✗` (red) means something is broken — the bottom of the doctor
output suggests how to fix each one. Anything `!` (yellow) is a warning;
the install still works.

Exit code: `0` if all checks green, `1` if any red — suitable for
scripted health gating.

## Re-running the installer

Re-running is safe. The installer checks what's already installed and
skips those steps. The most common reason to re-run is to update the
repo or regenerate `.env` after wiping a previous install.

To do a truly clean reset (mostly useful when testing the installer
itself):

```bash
# Mac/Linux:
cd ~/datasensai
docker compose --env-file .env -f docker/docker-compose.yml down -v
rm -rf ~/datasensai
./scripts/install/install.sh

# Windows:
cd $env:USERPROFILE\datasensai
docker compose --env-file .env -f docker\docker-compose.yml down -v
Remove-Item -Recurse -Force $env:USERPROFILE\datasensai
.\scripts\install\install.ps1
```

## Distribution

For internal use you can grab `scripts/install/` from the repo directly
via `git clone`. For shipping to a client:

1. ZIP the `scripts/install/` directory (drag `scripts/install/` onto
   Compress Files in Finder, or `zip -r installer.zip scripts/install/`)
2. Send the ZIP via Slack / email / shared drive
3. The recipient extracts and double-clicks `Install datasensAI.command`
   (Mac) or `Install datasensAI.bat` (Windows)

No `curl ... | bash` style "trust this remote URL and run it as root"
flow — many enterprises block that pattern. The ZIP gives the recipient
something they can inspect before running.

## Files in this directory

| File | What it is |
|---|---|
| `Install datasensAI.command` | **Mac users double-click this.** Opens Terminal and runs install.sh. |
| `Install datasensAI.bat` | **Windows users double-click this.** Triggers UAC, opens elevated PowerShell, runs install.ps1. |
| `install.sh` | The actual Mac/Linux installer (Bash, ~350 lines). |
| `install.ps1` | The actual Windows installer (PowerShell, ~280 lines). |
| `doctor.sh` | Mac/Linux health check. Run this when something looks wrong. |
| `doctor.ps1` | Windows health check. Same idea. |
| `README.md` | This file. |
