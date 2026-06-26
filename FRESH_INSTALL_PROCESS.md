# Fresh-Install Test Process — datasensAI v1.0

Your step-by-step for the two end-to-end tests you asked for:

1. **Mac wipe + fresh install** — proves the layman path works on a clean Mac
2. **Windows wipe + fresh install** — proves the same on a clean Windows VM/machine

When both pass, the same ZIP gets sent to Tejas.

---

## What you'll capture during each test

Open a text file as you run the test and record these as you go:

```
Machine: <Mac M2 16 GB | Mac Intel 8 GB | Windows 11 Surface | etc>
Network: <home WiFi 200 Mbps | office | mobile hotspot>
Started:   00:00:00
Got to Docker installed:   __:__:__
Got to Ollama installed:   __:__:__
gemma2:9b download done:   __:__:__
docker compose up done:    __:__:__
Dashboard responding:      __:__:__
Total elapsed:             __ minutes
Surprises:                 <anything that wasn't obvious>
Errors hit:                <none | list each + how you fixed>
doctor.sh at the end:      <copy/paste the summary line>
```

These five numbers are what tells us "the installer is layman-ready" or
"there's one more rough edge to file."

---

## Mac fresh install — step-by-step

### A. Wipe the Mac to fresh state

If you have datasensAI / Docker / Ollama leftovers from earlier dev work,
remove them in this exact order so nothing's left to confuse the installer.

```bash
# 1. Stop and remove any datasense containers + volumes
docker compose --env-file ~/datasensai/.env -f ~/datasensai/docker/docker-compose.yml down -v --rmi local 2>/dev/null || true

# 2. Remove the repo
rm -rf ~/datasensai ~/Desktop/Teja/Dashboards   # adjust if you cloned elsewhere

# 3. Uninstall Docker Desktop (this also clears all images/volumes globally)
#    Quit Docker Desktop from the menu bar first, then:
brew uninstall --cask docker --force 2>/dev/null || true
rm -rf ~/Library/Group\ Containers/group.com.docker \
       ~/Library/Containers/com.docker.* \
       ~/Library/Application\ Support/Docker\ Desktop \
       ~/Library/Preferences/com.docker.* \
       ~/.docker

# 4. Uninstall Ollama and its model cache (5 GB of disk)
brew services stop ollama 2>/dev/null || true
brew uninstall ollama 2>/dev/null || true
rm -rf ~/.ollama

# 5. Optionally uninstall Homebrew itself (if you want a truly clean test
#    that includes brew install). Skip if you want to leave brew alone.
# /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"

# 6. Verify nothing's left
which docker        # should say "docker not found"
which ollama        # should say "ollama not found"
ls ~/datasensai 2>&1 # should say "No such file or directory"
df -g $HOME | awk 'NR==2 {print $4}' # should be >= 20 GB free
```

If `which docker` still finds something, Docker Desktop didn't fully
uninstall — finish manually via Finder → Applications → drag Docker.app to
Trash.

### B. Run the installer

Now you're a "fresh user" — no Docker, no Ollama, no repo.

```bash
# Option 1 — double-click (the actual layman path)
#   1. Open Finder
#   2. Download / extract the installer ZIP somewhere (Desktop is fine)
#   3. Open the scripts/install/ folder
#   4. Double-click "Install datasensAI.command"
#   5. Terminal opens automatically, banner shows, install starts after 5 sec
#   6. Answer the prompts as they come up

# Option 2 — terminal (if you want a transcript of every line for debugging)
git clone https://github.com/LovaRK/telemetry-governance-ai.git ~/installer-test
cd ~/installer-test/scripts/install
time ./install.sh 2>&1 | tee ~/Desktop/install-log-mac.txt
```

### C. Watch the prompts

The installer will ask you to confirm before each install. Expect this
sequence on a clean Mac:

| Prompt | What to answer | Why |
|---|---|---|
| "Install Xcode Command Line Tools (provides git)?" | **y** | Need git to clone the repo |
| OS dialog: "Install Command Line Tools?" | **Install** (top button) | macOS native installer |
| (waiting for OS dialog to finish, then press Enter in Terminal) | press **Enter** | Resumes the installer |
| "Install Homebrew?" | **y** | Need brew to install Docker Desktop + Ollama |
| OS prompt for your Mac password | **type your password** | Homebrew install needs sudo |
| "Install Docker Desktop via Homebrew?" | **y** | This downloads ~700 MB |
| OS prompt for your Mac password | **type your password** | Docker Desktop install needs sudo |
| (Docker Desktop should auto-launch, otherwise launch from Applications) | (wait) | Docker daemon needs to start |
| "Press Enter when the whale icon shows 'Docker Desktop is running'" | press **Enter** | Resumes the installer |
| "Use local Ollama for AI analysis?" | **y** | Local LLM, free, private |
| "Install Ollama via Homebrew?" | **y** | Fast install |
| (ollama pull gemma2:9b runs for ~10 min) | (wait) | This is the slow step |
| "Admin email" | **your email** | Used to log into the dashboard |
| "Admin password (≥ 12 chars)" | **strong password** | Remember it — you'll need it next |
| "Overwrite .env if it exists?" | usually n on fresh, y on re-run | |
| (docker compose up runs for ~3 min) | (wait) | First-time build |
| (waiting for http://localhost:3002) | (wait) | Up to 4 min on first boot |

### D. Verify it worked

When the green success message appears:

```bash
# 1. Open the URL it printed
open http://localhost:3002

# 2. Log in with the email/password it printed

# 3. Run the doctor — every line should be green
~/datasensai/scripts/install/doctor.sh

# Expected: "Summary: 15+ ✓  0 or 1 !  0 ✗"
# The 1 warning is usually "Default tenant has no Splunk URL configured yet"
# which is correct — you haven't entered your Splunk URL yet.
```

### E. Connect to your Splunk + run pipeline

This is what proves the dashboard actually works end-to-end.

1. Dashboard top-right → **Settings** → **Splunk Configuration**
2. Enter YOUR Splunk URL (`https://<your-host>:8089`) and auth (Basic
   user:password or a Bearer token)
3. Click **Test Connection** until it goes green
4. Click **Save**
5. Back on the dashboard, click **Refresh**
6. Watch the pipeline stages turn green over ~20-25 min
7. When it's done: dashboard shows YOUR indexes (whatever
   `| metadata type=indexes` returns on your Splunk), not the mock's
   indexes

### F. Stop the clock + record

Note the elapsed time. Run `doctor.sh` again. Copy the summary line into
your test notes.

---

## Windows fresh install — step-by-step

### A. Wipe the Windows machine to fresh state

If this is a VM, the easiest reset is to revert to a clean snapshot. If
it's a real machine, do this:

```powershell
# Open PowerShell as Administrator

# 1. Stop and remove any datasense containers
cd $env:USERPROFILE\datasensai 2>$null
if (Test-Path .\docker\docker-compose.yml) {
  docker compose --env-file .env -f .\docker\docker-compose.yml down -v --rmi local
}
cd $env:USERPROFILE

# 2. Remove the repo
Remove-Item -Recurse -Force $env:USERPROFILE\datasensai 2>$null

# 3. Uninstall Docker Desktop
winget uninstall --id Docker.DockerDesktop
# Then reboot. Docker leaves system services running that only a reboot clears.

# 4. After reboot, open PowerShell as Administrator again
# Uninstall Ollama
winget uninstall --id Ollama.Ollama 2>$null
Remove-Item -Recurse -Force $env:USERPROFILE\.ollama 2>$null

# 5. Verify nothing's left
Get-Command docker -ErrorAction SilentlyContinue    # should be empty
Get-Command ollama -ErrorAction SilentlyContinue    # should be empty
Test-Path $env:USERPROFILE\datasensai               # should be False
[math]::Round((Get-PSDrive C).Free / 1GB, 1)        # should be >= 20
```

### B. Run the installer

```powershell
# Option 1 — double-click (the actual layman path)
#   1. Extract the installer ZIP onto your Desktop
#   2. Open the scripts\install folder
#   3. Double-click "Install datasensAI.bat"
#   4. UAC prompt appears - click YES
#   5. Elevated PowerShell window opens with the banner
#   6. After 5 seconds, install.ps1 starts and asks the prompts

# Option 2 — PowerShell (if you want a transcript)
#   Right-click PowerShell -> Run as Administrator
git clone https://github.com/LovaRK/telemetry-governance-ai.git $env:USERPROFILE\installer-test
cd $env:USERPROFILE\installer-test\scripts\install
$start = Get-Date
.\install.ps1 *>&1 | Tee-Object -FilePath $env:USERPROFILE\Desktop\install-log-windows.txt
Write-Host "Elapsed: $((Get-Date) - $start)"
```

### C. Watch the prompts

| Prompt | What to answer | Why |
|---|---|---|
| (script checks admin rights) | (auto) | Must be elevated, else exits |
| "Install Git via winget?" | **y** | Need git |
| (winget downloads + installs Git silently) | (wait) | ~30 seconds |
| "Install Docker Desktop via winget?" | **y** | ~700 MB |
| (winget downloads Docker Desktop) | (wait) | ~3-5 min |
| Docker Desktop installer dialog | **click through** | Standard Docker Desktop installer |
| (reboot may be required after Docker install) | **reboot** if prompted | Docker uses WSL2 features |
| (after reboot, re-launch the .bat file or re-run install.ps1) | (resume) | Installer picks up where it left off |
| "Press Enter when Docker Desktop says 'Docker Desktop is running'" | **Enter** | Daemon takes ~30 sec to start |
| "Use local Ollama for AI analysis?" | **y** | |
| "Install Ollama via winget?" | **y** | |
| (ollama pull gemma2:9b runs for ~10 min) | (wait) | Slow step |
| "Admin email" | **your email** | |
| "Admin password (≥ 12 chars)" — SecureString prompt | **strong password** | Hidden as you type |
| (docker compose up runs for ~3 min) | (wait) | First-time build |
| (waiting for http://localhost:3002) | (wait) | Up to 4 min |

### D. Verify it worked

```powershell
# 1. Open the URL
Start-Process http://localhost:3002

# 2. Log in with the email/password it printed

# 3. Run the doctor
& $env:USERPROFILE\datasensai\scripts\install\doctor.ps1

# Expected: "Summary: 15+ OK   0 or 1 !   0 X"
```

### E. Connect to your Splunk + run pipeline

Same as Mac Step E — Settings → Splunk Configuration → Test Connection →
Save → Refresh → wait ~20-25 min → see your real indexes.

### F. Stop the clock + record

---

## What "GREEN" looks like

After both tests, you should have:

| Test | Total time | doctor.sh / .ps1 result | Dashboard shows |
|---|---|---|---|
| Mac fresh install | 15-25 min | 15+ ✓, 0 ✗ | YOUR Splunk indexes |
| Windows fresh install | 20-30 min | 15+ OK, 0 X | YOUR Splunk indexes |

If those four cells all check out, the installer is ready for Tejas.

## What "RED" looks like + what to do

| Symptom | Likely cause | Fix |
|---|---|---|
| `xcode-select` dialog never appears on Mac | Mac already has CLT installed from a prior dev session — wipe wasn't complete | Skip the prompt; press Enter; installer continues |
| Docker Desktop daemon doesn't come up | macOS Gatekeeper blocked it | System Settings → Privacy & Security → "Allow Docker.app" |
| `ollama pull` hangs at 100% | Slow network finishing the manifest | Wait; Ollama eventually persists |
| `docker compose up` fails with port conflict | Port 3002 or 5433 in use by something else | Set `WEB_PORT=4000 ./install.sh` (Mac) or `-WebPort 4000` (Win) |
| Dashboard reaches login but the loop spins after submit | First boot Postgres still creating admin user | Wait 30 sec, try again; or `docker compose logs web \| grep "Admin Init"` |
| `doctor.sh` says "Default tenant points at sandbox host" | Leftover dev state | Settings → Splunk Configuration → enter YOUR URL → Save |

If you hit something not on this list, capture `doctor.sh` / `doctor.ps1`
output + the install log and we'll add a row.

## When both tests pass

Send Tejas:

1. The installer ZIP (`scripts/install/` zipped)
2. The Slack message from `HANDOVER_FOR_TEJAS_SLACK.md`
3. Your timing numbers from the test (sets his expectations: "Ram tested
   this on a clean Mac, took 22 min — yours should be similar")

Then he does the same flow on his machine, replies with the 5-field
validation report, and we merge.
