# datasensAI Dashboard — Final Handover Checklist for Teja

**Date:** June 26, 2026  
**Status:** Ready for Production Handover  
**Current Data:** Live Splunk at 144.202.48.85 (NOT mock data, NOT CSV lookups)

---

## What You're Getting

```
✅ Full datasensAI dashboard (Executive, Telemetry, Governance, Storage Cost)
✅ One-click installer (Mac + Windows)
✅ Reverse-engineering toolkit (load demo data into fresh Splunk)
✅ Production-safe installation (validates at every step)
✅ Real Splunk integration (queries via REST API, not CSV)
```

---

## Phase 1: Test on Mac (Fresh Install)

### Step 1A: Clone & Navigate
```bash
cd ~/Desktop/Teja/Dashboards
git checkout main
git pull origin main
```

### Step 1B: Run One-Click Installer
**Option A (GUI):**
- Open Finder
- Navigate to `scripts/install/`
- Double-click **`Install datasensAI.command`**

**Option B (Terminal):**
```bash
cd scripts/install
chmod +x install.sh
./install.sh
```

**Menu appears:**
```
1) Fresh install      ← CHOOSE THIS
2) Start existing
3) Repair install
4) Reset/reinstall
5) Export support logs
6) Stop app
7) Uninstall
```

### Step 1C: Wait for Completion
The installer will:
- ✅ Check system requirements
- ✅ Install Docker (if missing)
- ✅ Clone repo to ~/datasensai
- ✅ Auto-generate secure credentials
- ✅ Start containers
- ✅ Validate login (returns JWT)
- ✅ Save credentials to `~/datasensai/credentials.txt`
- ✅ Open browser at http://localhost:3002

**Typical time: 8-12 minutes** (first run downloads ~5GB AI model)

### Step 1D: Verify Installation
After installer finishes:

```
✅ Credentials file exists
   cat ~/datasensai/credentials.txt

✅ Can log in
   Email: (from credentials.txt)
   Password: (from credentials.txt)

✅ App loads without errors
   Open: http://localhost:3002
   Check browser console (F12) — no red errors

✅ Dashboard shows data
   All tabs visible: Executive, Telemetry, Governance, Storage Cost
   KPIs populated (rows, GB, savings)
   No "Connection Failed" messages
```

### Step 1E: Record Results

| Check | Status | Notes |
|-------|--------|-------|
| Installer completed | ✅/❌ | Time taken: ___ min |
| Credentials file created | ✅/❌ | Location: ~/datasensai/ |
| Login successful | ✅/❌ | |
| Browser loads | ✅/❌ | Any errors? |
| Dashboard shows data | ✅/❌ | Splunk connection working? |
| All tabs render | ✅/❌ | Executive, Telemetry, Governance, Cost |
| Filters work | ✅/❌ | Can change Cost/GB/Yr filters? |
| Refresh works | ✅/❌ | Pipeline runs end-to-end? |

---

## Phase 2: Test on Windows (Fresh Install)

### Step 2A: Clone & Navigate
```powershell
cd C:\Users\<YourName>\Desktop\Teja\Dashboards
git checkout main
git pull origin main
```

### Step 2B: Run One-Click Installer
**Option A (GUI):**
- Open Explorer
- Navigate to `scripts\install\`
- Double-click **`Install datasensAI.bat`**
- Click **Yes** on UAC prompt

**Option B (PowerShell Admin):**
```powershell
cd scripts\install
.\install.ps1
```

**Menu appears:**
```
1) Fresh install      ← CHOOSE THIS
2) Start existing
3) Repair install
4) Reset/reinstall
5) Export support logs
6) Stop app
7) Uninstall
```

### Step 2C: Wait for Completion
Same process as Mac (8-12 minutes first run)

- ✅ Checks Windows 10/11
- ✅ Installs Docker Desktop (if missing)
- ✅ Starts containers
- ✅ Validates login
- ✅ Saves credentials to `%USERPROFILE%\datasensai\credentials.txt`
- ✅ Opens browser

### Step 2D: Verify Installation

```powershell
# Check credentials file exists
type $env:USERPROFILE\datasensai\credentials.txt

# Check containers running
docker ps -a
```

Then same verification as Mac (login, tabs, data, filters).

### Step 2E: Record Results

| Check | Status | Notes |
|-------|--------|-------|
| Installer completed | ✅/❌ | Time taken: ___ min |
| Credentials file created | ✅/❌ | Location: %USERPROFILE%\datasensai\ |
| Login successful | ✅/❌ | |
| Browser loads | ✅/❌ | Any errors? |
| Dashboard shows data | ✅/❌ | Splunk connection working? |
| All tabs render | ✅/❌ | Executive, Telemetry, Governance, Cost |
| Filters work | ✅/❌ | Can change Cost/GB/Yr filters? |
| Refresh works | ✅/❌ | Pipeline runs end-to-end? |

---

## Phase 3: Connect Your Own Splunk (Optional)

If you want to point the dashboard at a **different Splunk instance** instead of 144.202.48.85:

### Step 3A: Get Splunk Connection Info
```
Splunk URL: https://<your-splunk-ip>:8089
Username: <your-admin>
Password: <your-password>
```

### Step 3B: Update Connection in App
1. Log in to dashboard
2. Click **⚙️ Settings**
3. Tab: **Splunk Connection**
4. Enter:
   - Management URL: `https://<your-ip>:8089`
   - Auth: Basic (username + password) or Splunk token
5. Click **Test Connection** (should turn green)
6. Click **Save**
7. Back to dashboard, click **Refresh**

**First refresh takes ~20 min** (AI analysis in background)

---

## Phase 4: Load Demo Data into Fresh Splunk (Optional)

If you want to populate a fresh Splunk with the same synthetic data we use:

```bash
cd tools/splunk_reverse_engineering

export SPLUNK_HOST=<your-splunk-ip>
export SPLUNK_PORT=8089
export SPLUNK_USERNAME=<admin>
export SPLUNK_PASSWORD=<password>
export SPLUNK_HEC_URL=https://<your-splunk-ip>:8088/services/collector
export SPLUNK_HEC_TOKEN=<your-hec-token>
export DATASENSAI_MODE=demo
export DATASENSAI_RUN_ID=demo-$(date +%Y%m%d)

# Create demo indexes
python3 create_indexes.py --force

# Create knowledge objects
python3 create_knowledge_objects.py

# Load synthetic events via HEC
python3 load_events.py --force

# Validate
python3 validate_demo_environment.py --compare-expected --run-id $DATASENSAI_RUN_ID
```

---

## If Something Breaks

### Run Doctor (Health Check)
```bash
# Mac/Linux
./scripts/install/doctor.sh

# Windows (Admin PowerShell)
.\scripts\install\doctor.ps1
```

Doctor will tell you exactly what's broken:
- ✅/❌ OS check
- ✅/❌ Disk space
- ✅/❌ Docker running
- ✅/❌ Containers healthy
- ✅/❌ Splunk connection
- ✅/❌ Login API

### Common Fixes

| Problem | Solution |
|---------|----------|
| Can't find credentials | Check `~/datasensai/credentials.txt` or `%USERPROFILE%\datasensai\credentials.txt` |
| Forgot password | Run installer → **Repair install** (auto-resets) |
| Port 3002 in use | Change in `.env` then run installer → **Repair** |
| Docker won't start | `docker-compose down -v && docker system prune -a` |
| Splunk connection fails | Verify IP is reachable: `ping <splunk-ip>` |
| Pipeline hangs | Check `docker logs docker-worker-1` |
| All scores show 0 | Splunk license might be Free/Expired (needs Enterprise) |

---

## Data Flow (Confirm This is Working)

```
Your Splunk Instance (144.202.48.85)
    ↓
Agent queries via REST API (/services/data/indexes, /services/search)
    ↓
Dashboard calculates KPIs & scores
    ↓
Browser renders live data (NOT CSV, NOT mock)
```

To verify the dashboard is pulling YOUR data, not hardcoded data:
1. In your Splunk, note total daily GB
2. In dashboard, it should match (or be close)
3. Index names should match your Splunk indexes
4. No hardcoded lists anywhere

---

## Final Checklist Before Handoff

- [ ] Mac installation tested (clean Docker, fresh clone, successful run)
- [ ] Windows installation tested (clean Docker, fresh clone, successful run)
- [ ] Both passed all verification checks (login, tabs, data, filters)
- [ ] Doctor runs with exit code 0 on both platforms
- [ ] Credentials file exists on both platforms
- [ ] Dashboard renders live Splunk data (not mocked)
- [ ] Refresh pipeline completes end-to-end
- [ ] No console errors in browser (F12 → Console)
- [ ] Filters work (Cost/GB/Yr, Storage/GB/Mo)
- [ ] All KPIs calculate (ROI, Savings, Spend)

---

## Known Limitations

⚠️ **Splunk Firewall:** If your Splunk is behind a cloud firewall (like Vultr):
- Port 8089 may be blocked externally
- Workaround: SSH tunnel or whitelist the IP running the dashboard

⚠️ **WinEventLog Events:** Some Windows event log sourcetypes are dropped by Splunk
- 16 events from `oswin` index are silently dropped (~5 GB)
- Root cause: Splunk's WinEventLog special event processing
- This does NOT affect scoring — only ~3% data variance

⚠️ **First Run Time:** First Refresh takes 20+ minutes (AI analysis in background)
- Subsequent refreshes: 2-3 minutes
- LLM narrative generation is async — check `/dashboard` logs

---

## Message for Handoff to Teja

**"The datasensAI dashboard is production-ready. One-click installers for Mac and Windows are in `scripts/install/`. Simply double-click `Install datasensAI.command` (Mac) or `Install datasensAI.bat` (Windows). The installer handles everything: Docker, setup, verification, and credentials. After 8-12 minutes, you'll have a working dashboard connected to your Splunk. All data flows through REST API queries — no CSV lookups, no mocks. See INSTALL_TEJA.md for full details and HANDOVER_CHECKLIST_TEJA.md for fresh-install testing steps."**

---

## Support

If something goes wrong:
1. Run doctor (`./scripts/install/doctor.sh` or `.ps1`)
2. Check logs: `docker-compose logs -f`
3. Check credentials file exists
4. Try **Repair install** from the menu
5. If still stuck, export logs: `./export-logs.sh` (.ps1 on Windows)
