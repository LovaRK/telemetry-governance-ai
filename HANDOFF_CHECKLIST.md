# Handoff Checklist (Teja — Day 1)

Do these in order. Each links to the doc with detail.

## Get it running

1. [ ] Clone, `git checkout v1.0-handoff`, `cp .env.example .env`
2. [ ] Fill `.env`: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and two
       `openssl rand -hex 32` secrets (`SPLUNK_SECRET_ENCRYPTION_KEY`,
       `GOVERNANCE_BOOTSTRAP_KEY`) — see `INSTALL_TEJA.md`
3. [ ] LLM Path A: install Ollama + `ollama pull gemma2:9b`
       (or Path B: set `ANTHROPIC_API_KEY`, opt in via Settings)
4. [ ] `docker compose -f docker/docker-compose.yml up -d`
5. [ ] Log in at http://localhost:3002 with your admin creds

## Point at Splunk & run

6. [ ] Settings → Splunk Connection → URL + auth → Test (green) → Save
7. [ ] (optional) Build the synthetic env: `scripts/env-prep/README.md`
8. [ ] Click **Refresh**; wait ~1–3 min for KPIs

## Validate

9.  [ ] `npx tsc --noEmit -p .` clean
10. [ ] `npx jest tests/golden-dataset` → 23 green (scoring == calc guide)
11. [ ] Refresh 3× → index counts + KPIs stable (`TALLY_CHECKLIST.md`)
12. [ ] Run the tally vs Data Sensei at cost 183 / weights 0.35-0.40-0.25
        and fill in `TALLY_CHECKLIST.md`
13. [ ] Generate the demo artifact: `node scripts/export-tally-report.mjs`

## Where everything lives

| Need | File |
|---|---|
| Install & run | `INSTALL_TEJA.md` |
| Demo Splunk env | `scripts/env-prep/README.md` |
| Clear stale data | `scripts/reset-demo-data.mjs` |
| Score methodology | datasensAI Calculation Guide (PDF) |
| Tally protocol | `TALLY_CHECKLIST.md` |
| Demo narrative | `DEMO_SCRIPT.md` |
| Limitations | `KNOWN_ISSUES.md` |
| If it breaks | `ROLLBACK_PLAN.md` |
| Prod gaps + secret rotation | `PRODUCTION_READINESS.md` |

## Release criteria (before tagging your own build on top)

All true:
- [ ] Live Splunk data (no CSV-era rows) — `reset-demo-data.mjs` then Refresh
- [ ] Deterministic scores persisted (LLM not inventing scores)
- [ ] 3× refresh stable
- [ ] root `tsc` clean; golden-dataset + client + mcp contract tests green
- [ ] Fresh Docker install works from a clean clone
- [ ] Secrets rotated; no real creds in files you edit
- [ ] Data Sensei tally documented in `TALLY_CHECKLIST.md`
- [ ] Score-audit artifact generated for the final run
