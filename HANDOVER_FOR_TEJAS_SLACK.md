---

**SLACK / CLAUDE PASTE BLOCK** — paste everything between the two `===` lines into Claude on Tejas's Mac (or `claude` CLI on Windows). Self-contained — no prior context needed.

```
=== START ===

Hey Claude, I'm installing the datasensAI dashboard on this laptop and need you to walk me through it end-to-end. I have my own Splunk Enterprise instance I want it to read from. The repo author already tested this on his machine and confirmed it works against his Splunk; I need to reproduce that on mine.

Here is everything you need:

REPO
- GitHub: <fill in repo URL>
- Branch: main  (latest deploy-ready code, includes 2026-06-24 fixes for pipeline-lease + token-refresh + 92 GB lookup)
- Auth file with all install steps: INSTALL_TEJA.md (at the repo root)

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
- After step 8: psql shows N indexes matching my Splunk's `| metadata type=indexes`
- After step 9: I understand the data path of every visible number on the dashboard

Start with step 1. Read the install guide, then ask me any clarifying questions before running anything.

=== END ===
```

---

## How the author tested this (for context, don't paste to Claude)

The repo's author (Ram) ran this exact flow today on a Mac M-series:
- Pipeline ran end-to-end against the sandbox Splunk mock; ~20-min run completed cleanly
- Dashboard showed 91.9 GB daily ingest (Teja's authoritative 92 GB number, normalized from the 1stmile customer profile lookup)
- Total spend $17k, ROI 73.7, GainScope 76.4%, Savings Potential $2k, 12 critical indexes
- All today's fixes verified live: HEARTBEAT events flowing per batch; lease never expired; access token survived the 20-min run without a forced logout

The same code path runs against any tenant's real Splunk — the only differences will be the index names (whatever `/services/data/indexes` returns on their instance) and the GB totals (theirs, not the mock's). No code changes needed.

## Files Tejas should NOT need to touch

`tools/sandbox/splunk-mock-server.ts`, `seed-data/*`, anything under `scripts/env-prep/` (used only for the synthetic dev demo).
