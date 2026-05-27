# Demo Runbook

**Purpose:** exact step-by-step browser flow for the current local demo  
**Last verified:** 2026-05-26

## 1. Start The Stack

Run from the repo root:

```bash
set -a
source .env.local
set +a
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d --build
```

Verify:

```bash
curl -s http://localhost:3002/api/health | jq
```

Expected:

- `status = healthy`

## 2. Open The App

Open:

`http://localhost:3002/login`

## 3. App Login Credentials

Use:

- Email: `admin@bitso.com`
- Password: `Admin@12345`

Expected behavior:

- successful login redirects to `/`
- user lands directly on dashboard when tenant config already exists

## 4. Why It Lands On Dashboard Instead Of Config

This is current expected behavior.

- The tenant already has Splunk configuration stored in Postgres.
- Because of that, the app does not force a first-run setup wizard.
- Settings still exists and can be opened separately.

## 5. Current Stored Splunk Configuration

These are the values currently returned by `GET /api/splunk/config` for the verified tenant:

- REST API URL: `https://144.202.48.85:8089`
- HEC URL: `https://45.76.167.6:8088`
- MCP URL: `https://144.202.48.85:8089/services/mcp`
- REST auth type: `BASIC`
- Username: `ram`
- SSL verify: `false`

If the app ever requires manual re-entry in Settings, the current working auth family is:

- REST API uses `BASIC`
- HEC uses token
- MCP uses the MCP URL

## 6. Splunk/Auth Inputs If Reconfiguration Is Needed

Only use these if the tenant config has been cleared and the form must be filled again.

### REST API

- API URL: `https://144.202.48.85:8089`
- Auth type: `BASIC`
- Username: `ram`
- Password: `Rama@1988`

### HEC

- HEC URL: `https://45.76.167.6:8088`
- HEC Token: `8cd86654-a388-4211-8ae9-35d71d0a5037`

### MCP

- MCP URL: `https://144.202.48.85:8089/services/mcp`

## 7. Expected Dashboard Landing State

After login, current expected signals are:

- page title: `datasensAI — Executive ROI Overview`
- `EXECUTIVE OVERVIEW` visible
- `Cache Fresh` visible
- terminal pipeline state visible in inspector

Current verified runtime path:

- login works
- dashboard loads
- refresh API can run
- latest refresh can reach `READY / READY / READY`

## 8. Important Notes For Demo

1. App login and Splunk credentials are different.
2. Splunk settings are for backend data access, not for logging into the app.
3. If config already exists, do not re-enter it during the demo unless the database was reset.
4. Remaining demo risk is dashboard correctness, not basic login/runtime boot.
