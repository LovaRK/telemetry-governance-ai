> 🚨 **DO NOT SEND TO TEJAS — HANDOVER PAUSED (2026-06-25)**
>
> Three fresh-install P0 bugs were found during the project owner's Mac test on 2026-06-24.
> v1.1.0 cannot be shipped until P0-FRESHINSTALL-1/2/3 in `BACKLOG_2026-06-24.md`
> are fixed and a clean fresh-install passes on both Mac and Windows.
> See `BACKLOG_2026-06-24.md` for details and fix branches.

---

**SLACK / CLAUDE PASTE BLOCK** — paste everything between the two `===` lines into Claude on Tejas's Mac (or `claude` CLI on Windows). Self-contained — no prior context needed.

```
=== START ===

Hey Claude, I'm installing the datasensAI dashboard on this laptop and need you to walk me through it end-to-end. I have my own Splunk Enterprise instance I want it to read from. The repo author already tested this on his machine and confirmed it works against his Splunk; I need to reproduce that on mine.

Here is everything you need:

REPO
- GitHub: <fill in repo URL>
- Branch: main  (latest deploy-ready code, includes 2026-06-24 fixes for pipeline-lease + token-refresh + 1stmile lookup-row-derived volume)
- Auth file with all install steps: INSTALL_TEJA.md (at the repo root)

IMPORTANT — NO MORE HARDCODED 92 GB
- A previous version of the code contained `LOGICAL_DAILY_GB = 92` which FORCED every customer's per-index GB to normalise to a 92 GB/day total, regardless of what their lookup actually contained. This was a Thamba Policy violation and has been REMOVED.
- The dashboard now derives every per-index daily-GB value from the customer's own lookup rows using `SUM(GB_idx_st_s) / DISTINCT(date)`. Whatever the rows say is what shows up.
- Concrete consequences for you:
  * If your 1stmile lookup CSV is 2 days of data summing to 159.93 GB, your dashboard shows ~80 GB/day, not 92.
  * If your CSV is 30 days summing to 2,760 GB, your dashboard shows ~92 GB/day.
  * If your CSV is anything else, your dashboard shows that calculated value exactly.
- "92 GB/day" is NOT an authoritative number anymore. It is only valid if your live Splunk lookup rows happen to calculate to 92.
- If your Splunk is unreachable or has no data, the pipeline fails visibly (e.g. "Splunk returned 0 indexes. Check index permissions.") — there is no silent fallback to fake or default values.

MY ENVIRONMENT
- OS: <Mac M-series | Mac Intel | Windows 11 + WSL2>
- Splunk URL (management port): https://<my-splunk-host>:8089
- Splunk auth: <Basic user:pass | Bearer token | JWT>
- Splunk has the 1stmile lookups loaded? <yes | no — if yes, expect ~92 GB/day; if no, expect physical currentDBSize-based numbers>
- LLM path: <local Ollama gemma2:9b (default) | Anthropic claude-3-5-sonnet (only if my laptop can't run gemma)>

WHAT I WANT YOU TO DO

1. Clone the repo, check out main, and read INSTALL_TEJA.md end-to-end before touching anything. Tell me if anything looks off for my OS.

2. Walk me through the .env file. Generate fresh SPLUNK_SECRET_ENCRYPTION_KEY and GOVERNANCE_BOOTSTRAP_KEY with `openssl rand -hex 32` (do NOT reuse the dev values from the repo). Set ADMIN_EMAIL + ADMIN_PASSWORD to something I pick.

3. If I picked local Ollama: install Ollama, pull gemma2:9b, confirm `curl http://localhost:11434/api/tags` lists it.
   If I picked Anthropic: tell me the Settings → AI Provider step happens AFTER first login; do not put the API key in .env unless asked.

4. Bring up the stack:
   docker compose --env-file .env -f docker/docker-compose.yml up -d
   Watch `docker compose ... logs -f web | grep -E "Migration|Admin Init|ready"` until you see admin init complete. Tell me when it's safe to open the browser.

5. Open http://localhost:3002, log in with my admin creds.

6. Walk me into Settings → Splunk Configuration. I'll paste my Splunk URL + auth. Help me hit "Test Connection" until it goes green, then Save.

7. Back on the dashboard, click Refresh. Tell me what to expect:
   - 5 grey stages will turn green: Splunk Fetch → Snapshot Write → KPI Aggregation → AI Decisions → Governance Sync → Publish → Completed
   - AI Decisions takes the longest (1 batch per index, ~70-90 s each on Ollama gemma2:9b)
   - For an 18-index environment this is 20-25 min total; do not panic if AI Decisions sits on one batch for a while
   - The pipeline now sends per-batch heartbeats so you should see "AI batch N/M · X decisions written" updating every ~75 s

8. WHEN IT FINISHES, verify it actually pulled MY data — not synthetic mock data. Run both psql commands from the "Verify it's pulling from YOUR Splunk" section of INSTALL_TEJA.md:
   docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -c "..."

   The index_name list should match exactly what `| metadata type=indexes` returns in my Splunk Search head. Show me both side by side. If they don't match, something is wrong — debug before continuing.

9. Then walk me through every dashboard tab — Executive Overview, Telemetry Detail, Governance, Storage Cost — and for each tile, tell me which DB column or API endpoint it reads from. I want zero "this might be hardcoded" — every number must trace back to my Splunk via the worker pipeline.

GUARDRAILS (important)
- Use my Splunk URL exactly as I gave it. Do NOT default to splunk-mock:18089 (that's the dev sandbox profile, not for me).
- Do NOT enable the --profile sandbox mode for docker compose (that would start splunk-mock which I don't want).
- Do NOT push my .env, my Splunk credentials, or any database export to the repo or to any cloud service. Local only.
- If anything destructive comes up (delete database, rm -rf node_modules, docker compose down -v, kill running pipeline), check with me first. Bring it up explicitly before doing it.
- If you find a real bug — something that materially breaks my install, not just a stylistic preference — flag it clearly with the symptom + the file + the line. Don't silently work around it.

KNOWN-GOOD CHECKPOINTS (so we both know we're on track)
- After step 4: `docker compose ps` shows postgres + web + worker all running, none restarting
- After step 5: I can log in and the dashboard shows "Awaiting first refresh"
- After step 7: pipeline reaches "Completed" with a green ✅, no red ✕ on any stage
- After step 8: psql shows N indexes matching my Splunk's `| metadata type=indexes`. The TOTAL daily-GB is whatever my lookup rows calculate to — do NOT expect exactly 92. If I want to see 92 specifically, I either need a lookup whose rows sum to exactly that, or the value is whatever my data implies.
- After step 9: I understand the data path of every visible number on the dashboard, including that the daily-GB number is `SUM(GB_idx_st_s) / DISTINCT(date)` from my own lookup CSV, not a code constant

Start with step 1. Read the install guide, then ask me any clarifying questions before running anything.

=== END ===
```

---

## How the author tested this (for context, don't paste to Claude)

The repo's author (Ram) ran this exact flow today on a Mac M-series, both before and after a Thamba Policy audit:

**Before audit (commit `000f480`)** — pipeline ran end-to-end against the sandbox; dashboard showed 91.9 GB. This number was forced by a hardcoded `LOGICAL_DAILY_GB = 92` constant in `apps/api/services/splunk-client.ts:273`, which scaled whatever the customer's lookup rows summed to to exactly 92. A Thamba Policy audit flagged this as a hardcoded business value injected by code, not derived from the customer's data — REQUIRED FIX.

**After audit (commit `d45d01e`)** — the constant was removed. The query now returns `SUM(GB_idx_st_s) / DISTINCT(date)` per index, derived purely from the customer's own lookup rows. Same sandbox now shows **87.48 GB** (= sum of mock dailyAvgGb values across 20 indexes, untouched by any normalization). Per-index values match the mock inputs exactly (main: 12.4 → 12.4, security: 8.2 → 8.2, …).

What this means for Tejas's instance:
- His dashboard will show **whatever his Splunk lookup rows calculate to** — 80, 87, 92, 159, doesn't matter.
- The "92 GB" number is no longer an authoritative target. It's only valid if his rows actually sum to that.
- If he wants 92 GB on the dashboard, he uploads a lookup whose rows imply 92 GB/day. We do not fudge it in code.

Other today's fixes carried into both commits: HEARTBEAT events flowing per batch, lease never expired, access token survived the ~20-min run without forced logout, pipeline reached "Completed" with green ✅ on all stages.

The same code path runs against any tenant's real Splunk — the only differences will be the index names (whatever `/services/data/indexes` returns on their instance) and the GB totals (their data, not anyone's mock). No code changes needed.

## Files Tejas should NOT need to touch

`tools/sandbox/splunk-mock-server.ts`, `seed-data/*`, anything under `scripts/env-prep/` (used only for the synthetic dev demo).

---

## The Slack message you actually send Tejas (paste this in DM)

```
Hi Tejas,

Please validate the current branch using INSTALL_TEJA.md on your machine, pointed at YOUR real production Splunk (not the 1stmile demo set).

Important context: the dashboard auto-discovers whatever indexes your Splunk has via /services/data/indexes — it does NOT need 1stmile data, env-prep scripts, or any seed data to work. Just install + point at your Splunk + Refresh.

Steps:
1. Clone the repo and checkout the handover branch (or main after merge).
2. Follow INSTALL_TEJA.md end-to-end (Steps 1–4). Skip Step 4's optional env-prep section — that's for demo-only environments, NOT for your real-Splunk validation.
3. Configure YOUR Splunk URL + token in Settings → Splunk Configuration.
4. Trigger Refresh from the dashboard.
5. Verify dashboard indexes match the output of `| metadata type=indexes` on your Splunk Search head — whatever indexes your prod has (could be anything; not 1stmile).
6. Verify each index's daily-GB matches your Splunk's actual ingest. Without the 1stmile lookup uploaded, the worker computes daily-GB as max(license_usage 24h ingest, currentDBSizeMB / retentionDays, sampled raw bytes) — so for a healthy Enterprise-licensed Splunk it'll match your `license_usage.log` 24h sum within rounding.
7. Confirm no mock data and no hardcoded numbers anywhere.

Please report back with these 5 fields:
1. OS (Mac/Windows)
2. Installation issues, if any
3. Dashboard URL reached successfully (yes/no)
4. Splunk validation result:
   - Indexes shown match `| metadata type=indexes`: yes/no — diff
   - Daily-GB shown matches your `index=_internal source=*license_usage.log earliest=-24h | stats sum(b) by idx`: yes/no — variance
5. Green/Red status (ready to merge / blockers found)

Expected behavior:
• Dashboard shows YOUR real prod indexes — could be any names, any count.
• Daily-GB matches your Splunk's real ingest within rounding.
• If your Splunk is unreachable or your token is wrong → app fails visibly with a clear error in the UI, no fake/default values.
• Pipeline run takes 20-25 min total on Ollama gemma2:9b; no forced logout during the run; no "lease expired" or "idle timeout" errors.

Once you validate this, we can test a second tenant Splunk in parallel to prove multi-tenant isolation, then promote this as the agent deployment baseline.

A separate "double-click installer" PR is queued for after your validation (P1-9 in BACKLOG_2026-06-24.md) — Mac .command file + Windows .bat wrapper around the shell installer. That's the layman-friendly path for future clients; you're testing the manual path first to prove the application correctness.

Branch: feature/2026-06-24-tejas-install-pipeline-fixes (or main after merge)
Install guide: INSTALL_TEJA.md (at the repo root)
Detailed Claude-walkthrough prompt: paste-block at the top of HANDOVER_FOR_TEJAS_SLACK.md
```

## Validation report template — paste into a reply

Use this exact shape so we can triage fast:

```
Tejas validation report — datasensAI v1.0 handover (real-prod Splunk)

1. OS: <Mac M-series | Mac Intel | Windows 11 | Windows 10>
2. Installation issues: <none | describe>
3. Dashboard URL reached: <yes — http://localhost:3002 | no — failed at step N>
4. Splunk validation against MY real prod Splunk (NOT 1stmile demo):
   - Indexes shown match `| metadata type=indexes` on my Splunk: <yes / no — diff>
   - Index count: dashboard shows N=__, my Splunk reports N=__
   - Daily-GB matches my license_usage 24h sum (`index=_internal source=*license_usage.log earliest=-24h | stats sum(b) by idx`): <yes — within X% / no — got Y vs expected Z>
   - Pipeline run completed: <yes / no — failed stage: __>
   - No forced logout during the 20-25 min run: <yes / no>
5. Status: <GREEN — ready to merge | RED — blockers below>

Blockers (if RED):
  - <one per line>

Optional notes / surprises:
  - <anything that wasn't clearly documented in INSTALL_TEJA.md>
```
