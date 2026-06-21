# Known Issues & Deferred Work — v1.0-handoff

Current limitations and intentionally-deferred items. None block the handoff;
each has a workaround or a clear owner.

## Environment blockers

- **Splunk trial license expired on the dev instance (144.202.48.85).**
  As of the handoff the demo Splunk box runs a Free/expired-trial license,
  which indexes events fine but rejects all search-time commands
  (`litsearch` → "license expired"). Effect: a live refresh returns zero
  scores even though data is present. **The scoring math is independently
  proven** against the calc guide by `tests/golden-dataset/` (23 passing
  fixtures). The live 5-index tally (F0) and the MITRE 3-sourcetype
  comparison (B6.5) must be re-run once a valid Enterprise license is in
  place. Everything code-side is ready.

## Deferred features (post-handoff)

- **MCP is flag + adapter only.** The real MCP server is not implemented.
  When `splunk_mcp_url` is set the adapter tries MCP and falls back to REST
  on every call, so it's safe but currently always falls back. Wire a real
  MCP server later.
- **SPL parser depth.** Sourcetype resolution uses literal `index=` regex +
  1/N attribution. The calc guide's full 9-method resolution, the
  Resolution Confidence KPI, and field-usage gap analysis are not
  implemented (stubs in `splunk-queries-service.ts`).
- **KO attribution granularity.** Knowledge objects are attributed at index
  level (`idx::_`), not per sourcetype. Tally at index granularity.
- **OTel traces to bitsIO Splunk Cloud.** Blocked on the collector
  endpoint/steps from Thai's side — nothing built yet.

## Code hygiene

- **`runAggregation()` is dead code.** The live path is `runFastAggregation()`.
  `runAggregation()` was refactored to share the new scoring helper but has
  no callers; kept for reference, remove in a later cleanup.
- **Secrets in git history.** Real credentials were committed historically
  (`.env.example`, `docker-compose.yml`, status `.md` files, `artifacts/`).
  Forward-facing files are now sanitized, but history was **not** rewritten.
  See `PRODUCTION_READINESS.md` — rotate the affected credentials.
- **Cost precision.** `cost_per_gb_per_day` is `numeric(10,4)`; $183/GB/yr
  stores as 0.5014 → $183.01/yr (0.005% over). Negligible for the tally; widen
  further only if exact-cent annual figures are required.

## Pre-existing web typecheck warnings

`apps/web` has strict-mode `tsc` warnings that predate this work (e.g.
`page.tsx` CacheStatus fields, `login/page.tsx` null params). They don't
affect the Next.js build or runtime. The root `tsc -p .` (the project's
authoritative gate) is clean.
