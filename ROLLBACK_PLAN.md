# Rollback Plan

If a change misbehaves in your environment, here's the escape hatch.

## Revert to the certified handoff

```bash
git fetch --tags
git checkout v1.0-handoff
docker compose -f docker/docker-compose.yml up -d --build
```

This is the known-good baseline: deterministic scoring wired, MCP fallback,
filter bar, all engine tests green.

## Reset telemetry without losing config

If scores look wrong or doubled but the code is fine, the data is usually
stale (mixed runs). Clear telemetry while preserving users, tenants, Splunk
config, governance ledger, and the model pointer:

```bash
node scripts/reset-demo-data.mjs --dry-run    # preview
node scripts/reset-demo-data.mjs              # clear
# then click Refresh in the UI
```

## Full rebuild (last resort)

Wipes the database volume — you'll re-create the admin user and re-enter
Splunk config:

```bash
docker compose -f docker/docker-compose.yml down
docker volume rm docker_postgres_data
docker compose -f docker/docker-compose.yml up -d --build
```

## If a refresh hangs

```bash
docker compose -f docker/docker-compose.yml logs --tail=100 worker
```

Common causes: Ollama not running / model not pulled (Path A), or no active
model pointer. The worker fails fast and the run is marked FAILED — fix the
cause and Refresh again. No partial/corrupt state is published.

## Verify you're on a good build

```bash
npx tsc --noEmit -p .                          # must be clean
npx jest tests/golden-dataset                  # 23 tests, scoring == calc guide
npx jest tests/contract/splunk-client-contract.contract.test.ts \
         tests/contract/mcp-adapter-fallback.contract.test.ts
```
