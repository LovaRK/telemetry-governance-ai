# Run Dashboard Locally on localhost:3002

## Prerequisites
- Docker Desktop running
- Git repository cloned

## Quick Start (2 minutes)

```bash
cd /Users/ramakrishna/Desktop/Teja/Dashboards
./START.sh
```

Then open browser: **http://localhost:3002**

---

## What the Script Does

1. ✅ Checks Docker is running
2. ✅ Starts PostgreSQL (port 5432)
3. ✅ Starts Ollama (port 11434)
4. ✅ Starts Next.js web app (port 3002)
5. ✅ Waits for all services to be ready
6. ✅ Prints dashboard URL

---

## Manual Startup (If Script Fails)

```bash
cd /Users/ramakrishna/Desktop/Teja/Dashboards

# Start all services
docker-compose -f docker/docker-compose.yml up -d

# Watch logs
docker-compose -f docker/docker-compose.yml logs -f

# Open in browser when ready
open http://localhost:3002
```

---

## What You'll See

### Step 1: Connection Gating
```
Configure Splunk Connection
- Splunk URL: [empty form]
- API Token: [empty form]
[Connect & Refresh]
```

The dashboard won't load until you provide Splunk credentials because **all data must come from real Splunk, no mock data.**

### Step 2: After Connection
Once you enter real Splunk URL + token and click Refresh:
- Dashboard fetches real index metrics from Splunk
- LLM processes them (Ollama or Claude)
- Results stored in PostgreSQL
- UI populates with real data

---

## Verification Checklist

After running `./START.sh`:

```bash
# Check 1: Services Running
docker ps | grep dashboards

# Should show:
# - dashboards-postgres-1  ✓
# - dashboards-ollama-1    ✓
# - dashboards-web-1       ✓

# Check 2: PostgreSQL Connected
docker-compose -f docker/docker-compose.yml exec postgres psql -U root -c "SELECT 1"
# Should return: 1 ✓

# Check 3: Ollama Ready
docker-compose -f docker/docker-compose.yml exec ollama ollama list
# Should show gemma2 or similar ✓

# Check 4: Web Service Running
curl http://localhost:3002
# Should return HTML ✓

# Check 5: API Available
curl http://localhost:3002/api/config
# Should return config JSON ✓
```

---

## Connecting to Real Splunk

### Required:
1. **Splunk URL**: `https://your-splunk-instance.com:8089`
2. **API Token**: Create in Splunk Settings > Account > Tokens

### Steps:
1. Open http://localhost:3002
2. Paste Splunk URL
3. Paste API token
4. Click "Connect & Refresh"
5. Wait 30-60 seconds for first data load

---

## Troubleshooting

### "Connection refused on port 3002"
```bash
# Check if web service is running
docker-compose -f docker/docker-compose.yml logs web

# Restart it
docker-compose -f docker/docker-compose.yml restart web
```

### "PostgreSQL failed to start"
```bash
# Check logs
docker-compose -f docker/docker-compose.yml logs postgres

# Restart with fresh volume
docker-compose -f docker/docker-compose.yml down
docker volume rm dashboards_postgres_data
docker-compose -f docker/docker-compose.yml up -d postgres
```

### "Ollama is not responding"
```bash
# Check model is loaded
docker-compose -f docker/docker-compose.yml exec ollama ollama list

# If empty, pull model
docker-compose -f docker/docker-compose.yml exec ollama ollama pull gemma2:2b
```

### "Dashboard shows 'No Data' even after connecting Splunk"
```bash
# Check backend logs
docker-compose -f docker/docker-compose.yml logs web | tail -50

# Verify Splunk connection was saved
docker-compose -f docker/docker-compose.yml exec postgres psql -U root -d dashboard -c "SELECT * FROM cache_metadata;"
```

---

## Stopping Services

```bash
# Stop all (keep data)
docker-compose -f docker/docker-compose.yml down

# Stop and delete everything
docker-compose -f docker/docker-compose.yml down -v
```

---

## Real Data Requirement

⚠️ **CRITICAL**: The application ONLY displays real data from Splunk.

- No mock data
- No hardcoded values  
- No placeholder text
- All numbers come from actual Splunk queries

If no Splunk connection exists, dashboard shows:
```
"Configure Splunk Connection"
"No data available in demo mode"
```

This is by design. **Never fake data or confidence.**

---

## Expected Timeline

| Step | Time |
|------|------|
| Docker startup | 30-60s |
| PostgreSQL ready | 10-20s |
| Ollama ready | 10-20s |
| Web service ready | 15-30s |
| **Total** | **1-2 minutes** |

| Step | Time |
|------|------|
| Splunk connection | 5s |
| First data fetch | 30-60s (depends on Splunk instance size) |
| LLM processing | 30-90s (depends on index count) |
| Dashboard render | 5-10s |
| **Total (after connect)** | **1-3 minutes** |

---

## Ports Used

| Service | Port | Access |
|---------|------|--------|
| Dashboard | 3002 | http://localhost:3002 |
| PostgreSQL | 5432 | localhost:5432 (root/root) |
| Ollama | 11434 | http://localhost:11434 |

---

## Next: See Production Readiness

After verifying this works locally, see `PRODUCTION_READINESS.md` for:
- Full scope of remaining work (86 hours)
- Week-by-week timeline
- What's currently stubbed vs. real
- How to connect real Splunk data end-to-end
