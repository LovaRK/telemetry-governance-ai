# datasensAI — Installation Guide (Handover)

**Version:** Kodak validation branch (`fix/layman-friendly-installer`)  
**Date:** June 26, 2026  
**Audience:** Anyone installing datasensAI on a Mac or Windows laptop for the first time.  
**Goal:** After following these steps, you will have a working datasensAI dashboard populated with live data from your own Splunk instance.

---

## Table of Contents

1. [What You Need Before Starting](#1-what-you-need-before-starting)
2. [Install Prerequisites — macOS](#2-install-prerequisites--macos)
3. [Install Prerequisites — Windows](#3-install-prerequisites--windows)
4. [Download the Application Code](#4-download-the-application-code)
5. [Configure the Application](#5-configure-the-application)
6. [Install the AI Model (Ollama)](#6-install-the-ai-model-ollama)
7. [Start the Application](#7-start-the-application)
8. [First Login](#8-first-login)
9. [Connect Your Splunk Instance](#9-connect-your-splunk-instance)
10. [Run the Pipeline](#10-run-the-pipeline)
11. [Verify the Dashboard](#11-verify-the-dashboard)
12. [Troubleshooting](#12-troubleshooting)
13. [Stopping and Restarting](#13-stopping-and-restarting)
14. [Appendix: Port Reference](#14-appendix-port-reference)

---

## 1. What You Need Before Starting

Before you begin, make sure you have the following:

| Item | Details |
|------|---------|
| **Computer** | Mac (Intel or Apple Silicon) or Windows 10/11 laptop or desktop |
| **RAM** | Minimum 8 GB (16 GB recommended for smooth AI model performance) |
| **Disk Space** | At least 10 GB free |
| **Internet** | Required for initial setup (downloading software). Not required after setup is complete. |
| **Splunk Enterprise** | A running Splunk instance with management port 8089 accessible from your laptop. You will need: the Splunk URL (e.g., `https://your-splunk-server:8089`), a username, and a password. **Important:** Splunk must have an active Enterprise license — a Free or expired trial license blocks search commands and will result in all scores showing as zero. |

---

## 2. Install Prerequisites — macOS

You need to install three pieces of software: **Docker Desktop**, **Git**, and **Ollama** (the AI model runner).

### Step 2.1: Install Docker Desktop

Docker is the engine that runs the application. Everything runs inside Docker containers — you do not need to install Node.js, PostgreSQL, or anything else manually.

1. Open your web browser and go to: **https://www.docker.com/products/docker-desktop/**
2. Click **"Download for Mac"**
   - If your Mac has an Apple Silicon chip (M1, M2, M3, M4), choose **"Apple Silicon"**
   - If your Mac has an Intel chip, choose **"Intel Chip"**
   - Not sure? Click the Apple logo (top-left of your screen) → "About This Mac" → look for "Chip"
3. Open the downloaded `.dmg` file
4. Drag the Docker icon into your Applications folder
5. Open Docker Desktop from your Applications folder
6. Docker will ask for permission to install its networking components — click **"OK"** and enter your Mac password
7. Wait until Docker Desktop shows **"Docker Desktop is running"** in the bottom-left corner (green indicator)

**Verify Docker is working:**
Open the Terminal app (search for "Terminal" in Spotlight with Cmd+Space), then type:

```bash
docker --version
```

You should see something like: `Docker version 27.x.x` — any version 20+ is fine.

**Important for first launch:** Docker Desktop can take 5-10 minutes to fully
start the very first time. Do not cancel immediately if it looks slow. Keep the
Terminal open, watch the Docker whale icon in the menu bar, and wait until it
shows Docker is running. If it is still not ready after about 10-12 minutes,
run:

```bash
docker version
```

If you only see `Client:` and not `Server:`, Docker is still starting.

If it seems stuck, try:

```bash
open -a Docker
# if still stuck after a few more minutes
osascript -e 'quit app "Docker"'
open -a Docker
```

The Mac installer also performs one automatic Docker restart before failing, so
manual restart is only needed if Docker still does not bring up the backend
after that recovery step.

### Step 2.2: Install Git

Git is used to download the application code.

1. Open Terminal
2. Type: `git --version`
3. If Git is not installed, macOS will prompt you to install the Command Line Tools — click **"Install"** and wait
4. After installation, run `git --version` again — you should see a version number

### Step 2.3: Install Ollama

Ollama runs the AI model locally on your machine. No data leaves your laptop.

1. Open your web browser and go to: **https://ollama.com/download**
2. Click **"Download for macOS"**
3. Open the downloaded file and move Ollama to your Applications folder
4. Open Ollama from Applications — it will appear as a small icon in your menu bar (top-right of screen)
5. Open Terminal and run:

```bash
ollama pull gemma2:9b
```

This downloads the AI model (~5 GB). It will take a few minutes depending on your internet speed.

6. Verify the model is ready:

```bash
ollama list
```

You should see `gemma2:9b` in the list.

---

## 3. Install Prerequisites — Windows

### Step 3.1: Install Docker Desktop

1. Open your browser and go to: **https://www.docker.com/products/docker-desktop/**
2. Click **"Download for Windows"**
3. Run the downloaded installer (`.exe` file)
4. During installation:
   - Check **"Use WSL 2 instead of Hyper-V"** (recommended)
   - If prompted to install WSL 2, follow the instructions — you may need to restart your computer
5. After installation, open Docker Desktop from the Start Menu
6. Wait until it shows **"Docker Desktop is running"** (green indicator)

**Verify Docker is working:**
Open **Command Prompt** (search for "cmd" in Start Menu) or **PowerShell**, then type:

```cmd
docker --version
```

**Important for first launch:** on Windows, Docker Desktop can also take several
minutes on first boot. Wait for the whale icon in the system tray to settle.
If it is still not ready after about 10-12 minutes, run:

```cmd
docker version
```

If only the `Client:` section appears, Docker is still starting. If it remains
stuck, open Docker Desktop again from the Start Menu or fully quit and relaunch
it.

### Step 3.2: Install Git

1. Go to: **https://git-scm.com/download/win**
2. Download and run the installer
3. During installation, accept all default options
4. After installation, open a **new** Command Prompt and verify:

```cmd
git --version
```

### Step 3.3: Install Ollama

1. Go to: **https://ollama.com/download**
2. Click **"Download for Windows"**
3. Run the installer
4. After installation, open Command Prompt and run:

```cmd
ollama pull gemma2:9b
```

Wait for the download to complete (~5 GB).

5. Verify:

```cmd
ollama list
```

---

## 4. Download the Application Code

Open Terminal (Mac) or Command Prompt (Windows) and run:

```bash
git clone https://github.com/LovaRK/telemetry-governance-ai.git datasensai
cd datasensai
git checkout fix/layman-friendly-installer
```

This downloads the application code and switches to the latest validated Kodak handoff branch.

---

## 5. Configure the Application

### Step 5.1: Create your configuration file

```bash
cp .env.example .env
```

This creates a file called `.env` from the template.

### Step 5.2: Edit the configuration

Open the `.env` file in a text editor:

- **Mac:** `open -e .env` (opens in TextEdit) or `nano .env` (in Terminal)
- **Windows:** `notepad .env`

Change these values:

```bash
# Your login credentials (pick anything you want)
ADMIN_EMAIL=your.email@company.com
ADMIN_PASSWORD=YourStrongPassword123!

# Security keys — generate unique random values
# Mac: run each command in Terminal to generate a key
#   openssl rand -hex 32
# Windows: run in PowerShell
#   -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
SPLUNK_SECRET_ENCRYPTION_KEY=<paste your 64-character hex key here>
GOVERNANCE_BOOTSTRAP_KEY=<paste your 64-character hex key here>
```

**Important:** 
- Do NOT change `WEB_PORT`, `POSTGRES_PORT`, or any other settings unless you know what you're doing.
- Leave `NEXT_PUBLIC_SPLUNK_MCP_URL` and `NEXT_PUBLIC_SPLUNK_TOKEN` **blank** — you will configure Splunk through the application's Settings page after login.
- Leave `ANTHROPIC_API_KEY` blank unless you specifically want to use Anthropic's cloud AI instead of the local Ollama model.

Save and close the file.

---

## 6. Install the AI Model (Ollama)

If you haven't already done this in Step 2.3 (Mac) or Step 3.3 (Windows):

```bash
ollama pull gemma2:9b
```

Make sure Ollama is running:
- **Mac:** Look for the Ollama icon in the menu bar. If it's not there, open Ollama from Applications.
- **Windows:** Look for the Ollama icon in the system tray (bottom-right). If it's not there, open Ollama from the Start Menu.

Verify Ollama is accessible:

```bash
curl http://localhost:11434/api/tags
```

You should see a response containing `gemma2:9b`. If you get "connection refused", Ollama is not running — start it first.

---

## 7. Start the Application

Make sure you are in the `datasensai` folder, then run:

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

**What happens:**
1. Docker builds three containers: **web** (the dashboard), **worker** (the AI engine), and **postgres** (the database)
2. First build takes 3–5 minutes (subsequent starts are faster)
3. The web container runs database migrations automatically on first boot
4. Your admin user is created from the credentials in `.env`
5. If Docker Desktop itself was just installed, it may still be warming up in the background before this command succeeds

**Watch the startup progress:**

```bash
docker compose --env-file .env -f docker/docker-compose.yml logs -f web
```

Wait until you see a line like:
```
✓ Ready in Xs
```

Press `Ctrl+C` to stop watching the logs (the application keeps running).

**Check all containers are healthy:**

```bash
docker compose --env-file .env -f docker/docker-compose.yml ps
```

You should see three containers, all showing `Up` or `Up (healthy)`:

| Name | Status |
|------|--------|
| web | Up (healthy) |
| worker | Up |
| postgres | Up (healthy) |

---

## 8. First Login

1. Open your web browser
2. Go to: **http://localhost:3002**
3. You will see the datasensAI login page
4. Enter the email and password you set in `.env` (Step 5.2)
5. Click **"Sign In"**

You will see the Executive Overview dashboard — it will be empty because no Splunk connection has been configured yet.

---

## 9. Connect Your Splunk Instance

1. Click **"⚙ Settings"** in the top navigation bar (or go directly to `http://localhost:3002/settings`)
2. You will see the **Splunk Connection** tab

Fill in:

| Field | What to enter |
|-------|---------------|
| **Splunk Management URL** | Your Splunk server's management URL, e.g., `https://your-splunk-server:8089`. This is the REST API port, not the web UI port. |
| **Authentication Token** | Enter as `Basic <base64>` where `<base64>` is the Base64 encoding of `username:password`. Alternatively, if you have a Splunk Bearer token, enter `Bearer <your-token>`. |
| **Disable SSL Verify** | Check this box if your Splunk uses a self-signed certificate (common in non-production environments). |

### How to create the Basic auth token:

**Mac Terminal:**
```bash
echo -n "your_splunk_username:your_splunk_password" | base64
```

**Windows PowerShell:**
```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("your_splunk_username:your_splunk_password"))
```

Copy the output and enter it as: `Basic <the output>`

Example: If your username is `admin` and password is `MyPassword123`, and the base64 output is `YWRtaW46TXlQYXNzd29yZDEyMw==`, enter:
```
Basic YWRtaW46TXlQYXNzd29yZDEyMw==
```

3. Click **"Test Connection"**
   - If successful, you'll see a green checkmark and "Connection successful"
   - If it fails, verify your URL, credentials, and that your Splunk server is reachable from your laptop (try `curl -k https://your-splunk-server:8089/services/server/info` in Terminal)
4. Click **"Save"**

---

## 10. Run the Pipeline

The pipeline is the process that:
1. Queries your Splunk instance for all sourcetypes, indexes, and their metadata
2. Calculates deterministic scores (Utilization, Detection, Quality) for each sourcetype
3. Runs each sourcetype through the AI model for narrative analysis and action recommendations
4. Aggregates everything into executive KPIs and populates the dashboard

**To run the pipeline:**

1. Go back to the main dashboard (`http://localhost:3002`)
2. Click the **"Refresh"** button (or "Start Pipeline" if it's the first run)
3. A progress indicator will appear showing the pipeline status
4. Wait for completion — this typically takes **1–5 minutes** depending on:
   - How many sourcetypes/indexes exist in your Splunk (more = longer)
   - Your laptop's CPU speed (affects AI model processing)
   - Network latency to your Splunk server

**What you'll see during the pipeline run:**
- "Pipeline Running" status in the header
- The worker processes each sourcetype one by one
- Once complete, the status changes to "Cache Fresh ✓ Complete"

**Monitor pipeline progress (optional):**

```bash
docker compose --env-file .env -f docker/docker-compose.yml logs -f worker
```

You'll see lines like:
```
[BATCH] Processing 1/18: sourcetype=access_combined ...
[BATCH] Processing 2/18: sourcetype=syslog ...
...
Job complete — 18 decisions written.
```

---

## 11. Verify the Dashboard

After the pipeline completes, the dashboard should show populated data. Here's what to check:

### Executive Overview (main page)

| Widget | What You Should See |
|--------|-------------------|
| **ROI Score** | A number between 0–100 (semicircle gauge). This is the overall return-on-investment score for your telemetry. |
| **GainScope** | A percentage (semicircle gauge). Shows what percentage of your spend has optimization potential. |
| **Savings Potential** | A dollar amount (e.g., "$86"). Total estimated annual savings. |
| **Annual Spend** | Total cost of your current telemetry ingestion. |
| **Low-Value Spend** | Dollar amount of spend on low-value sourcetypes. May be $0 if all your sourcetypes score above the "Low-Value" threshold. |
| **Tier Distribution** | Bar chart showing how many sourcetypes fall into Critical / Important / Nice-to-Have / Low-Value tiers. |
| **Savings Staircase** | 5-bar chart showing the savings journey: Current → After Ingest Optimization → After Retention Tuning → After S3/Archive → Optimized Target. |
| **Quick Wins** | Cards showing the top sourcetypes where quick action yields savings. |

### Detail / Enhanced Viz (`/detail` page)

- Per-sourcetype scoring table with Utilization, Detection, Quality, and Composite scores
- Health Board heatmap
- Resolution Confidence gauge
- Retention analytics

### Governance (`/governance` page)

- Queue of AI recommendations you can approve or reject
- Each recommendation shows the AI's reasoning, confidence, and suggested action

### Settings (`/settings` page)

- **Splunk Connection** tab: Your configured Splunk URL
- **AI Provider** tab: Shows "Local (Ollama gemma2:9b)" by default
- **Scoring Weights** tab: Configurable weights for Utilization (default 0.35), Detection (default 0.40), Quality (default 0.25)

---

## 12. Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| `Must set GOVERNANCE_BOOTSTRAP_KEY` error when starting | Missing value in `.env` | Run `openssl rand -hex 32` and paste the result next to `GOVERNANCE_BOOTSTRAP_KEY=` in your `.env` file |
| `Must set ADMIN_PASSWORD` error | Missing value in `.env` | Set `ADMIN_PASSWORD=YourPassword` in `.env` |
| Installer or startup appears stuck at Docker | First Docker Desktop boot can take 5-10 minutes. Keep the terminal open, check the whale icon, and run `docker version` in a second terminal to confirm whether the daemon is still starting. |
| All scores show as 0 | Splunk license is Free/expired | datasensAI requires Splunk Enterprise with an active license. Free and expired trial licenses block search commands. |
| "Pipeline failed" error | Splunk connection issue or Ollama not running | Check: (1) Is Ollama running? (2) Is Splunk reachable? Run `docker compose logs worker` to see the error. |
| Worker keeps restarting | Postgres not ready or Ollama not reachable | Run `docker compose logs worker` — look for connection errors. Make sure Ollama is running on your host. |
| Port 3002 already in use | Another application is using that port | Change `WEB_PORT=3003` (or another free port) in `.env` and restart |
| "Connection refused" when testing Splunk | Splunk not reachable from Docker | Make sure your Splunk's port 8089 is accessible. If Splunk is on the same machine, use `https://host.docker.internal:8089` as the URL. |
| Slow performance / laptop freezing | Not enough RAM for the AI model | Close other applications. If still slow, consider using Anthropic's cloud AI: set `ANTHROPIC_API_KEY` in `.env`, then go to Settings → AI Provider → select Anthropic. |
| Dashboard shows old data | Cached results from a previous run | Click "Refresh" to run a new pipeline. If data still looks stale, run the reset script: `node scripts/reset-demo-data.mjs` then Refresh again. |
| Docker build fails with "no space left on device" | Docker's disk is full | In Docker Desktop → Settings → Resources → increase Disk image size, or run `docker system prune` to clean old images |

### Checking Container Logs

To see what's happening inside the application:

```bash
# All containers
docker compose --env-file .env -f docker/docker-compose.yml logs

# Just the web application
docker compose --env-file .env -f docker/docker-compose.yml logs web

# Just the AI worker
docker compose --env-file .env -f docker/docker-compose.yml logs worker

# Follow logs in real-time
docker compose --env-file .env -f docker/docker-compose.yml logs -f worker
```

### Rebuilding from Scratch

If something is fundamentally broken and you want to start fresh:

```bash
# Stop everything and remove all data
docker compose --env-file .env -f docker/docker-compose.yml down -v

# Rebuild and start
docker compose --env-file .env -f docker/docker-compose.yml up -d --build
```

**Note:** The `-v` flag removes the database volume, so all data is lost. You'll need to run the pipeline again after rebuilding.

---

## 13. Stopping and Restarting

### Stop the application (keeps your data):

```bash
docker compose --env-file .env -f docker/docker-compose.yml down
```

### Start it again later:

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Your data is preserved in Docker volumes — you don't need to run the pipeline again unless you want fresh data.

### Restart just the worker (e.g., after changing AI settings):

```bash
docker compose --env-file .env -f docker/docker-compose.yml restart worker
```

---

## 14. Appendix: Port Reference

| Service | Internal Port | Host Port | Purpose |
|---------|--------------|-----------|---------|
| Web (Dashboard) | 3000 | 3002 (configurable via `WEB_PORT`) | The web UI — open this in your browser |
| PostgreSQL | 5432 | 5433 (configurable via `POSTGRES_PORT`) | Database — no need to access directly |
| Worker | — | — | Background process, no external port |
| Ollama | 11434 | 11434 | AI model server — runs on your host machine, not in Docker |
| Splunk | 8089 | — | Your external Splunk instance — not managed by datasensAI |

---

**End of Installation Guide**

If you encounter any issues not covered here, check the `KNOWN_ISSUES.md` file in the application folder, or contact the development team.
