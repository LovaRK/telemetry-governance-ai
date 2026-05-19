# Running the System Locally

## Prerequisites

- Node.js 18+ (`node --version`)
- Docker Desktop (for Mac/Windows) or Docker daemon (for Linux)
- PostgreSQL 16 (if not using Docker)
- Redis 7 (if not using Docker)

## Quick Start (5 minutes)

### 1. Start Docker Daemon

**Mac (Docker Desktop):**
```bash
open /Applications/Docker.app
# Or if you have Docker installed via Homebrew:
brew services start docker
```

**Linux:**
```bash
sudo systemctl start docker
```

**Verify Docker is running:**
```bash
docker ps
# Should show container list without "Cannot connect to Docker daemon" error
```

### 2. Start System Services

```bash
# From project root
npm run dev

# This starts:
# - PostgreSQL on 0.0.0.0:5433
# - Redis on 0.0.0.0:6379
# - API server on 0.0.0.0:3001
# - Web app on 0.0.0.0:3002
```

Wait for output showing "All services ready" (~30 seconds).

### 3. Access the Dashboard

Open in browser:
```
http://localhost:3002
```

You should see the **datasensAI** connection screen.

## Running Tests Locally

### Chaos Tests (5-10 minutes)

```bash
# Install dependencies first (one-time)
npm install --save-dev vitest @testcontainers/postgresql @testcontainers/testcontainers ioredis node-fetch

# Run all chaos tests
npm run test:chaos

# Watch mode (auto-rerun on file changes)
npm run test:chaos:watch

# With coverage report
npm run test:chaos:coverage
```

Expected output:
```
✓ 4 test files
✓ 16 tests total
✓ All green (~30 seconds)
```

### E2E Tests (Web Dashboard)

```bash
# Web app must be running on http://localhost:3002
# Verify: curl http://localhost:3002 (should return HTML)

# Run all E2E tests
npm run test:e2e

# Run with UI (interactive mode)
npm run test:e2e:ui

# Debug mode (step through)
npm run test:e2e:debug

# Watch mode
npm run test:e2e:watch
```

Expected output:
```
✓ 12 passed in 13.4s
```

### Unit Tests

```bash
npm run test
npm run test:watch
npm run test:coverage
```

## Complete Local Workflow

```bash
# 1. Start services (Terminal 1)
npm run dev

# 2. Wait for "Services ready" message (30-60 seconds)

# 3. In Terminal 2, run tests
npm run test:chaos      # Verify core logic
npm run test:e2e        # Verify UI has no hard-coded data

# 4. Open dashboard (Terminal 3 or browser)
open http://localhost:3002

# 5. Connect to Splunk (if available)
# - Enter Splunk URL in connection form
# - Click "Connect & Refresh"
# - Wait for LLM pipeline to run (up to 5 min)
# - View results on dashboard
```

## Verifying the Setup

### Health Checks

```bash
# Check API is running
curl http://localhost:3001/health
# Should return: {"status":"healthy"}

# Check web app is running
curl http://localhost:3002
# Should return: HTML with datasensAI app

# Check database
curl -u root:password http://localhost:5433 2>/dev/null || echo "PostgreSQL ready"

# Check Redis
redis-cli ping
# Should return: PONG
```

### View Logs

```bash
# All containers
docker-compose -f docker/docker-compose.yml logs

# Specific service
docker-compose -f docker/docker-compose.yml logs api
docker-compose -f docker/docker-compose.yml logs web
docker-compose -f docker/docker-compose.yml logs postgres
```

## Stopping Services

```bash
# Stop all containers
npm run clean

# Or manually
docker-compose -f docker/docker-compose.yml down

# Clean up volumes (⚠️ Deletes all data)
docker-compose -f docker/docker-compose.yml down -v
```

## Troubleshooting

### Docker Daemon Not Running

```bash
# Mac
open /Applications/Docker.app

# Linux
sudo systemctl restart docker

# Verify
docker ps
```

### Port Already in Use

```bash
# Find what's using port 3002
lsof -i :3002

# Kill process
kill -9 <PID>

# Or use different port
PORT=3003 npm run dev
```

### PostgreSQL Connection Failed

```bash
# Check if container is running
docker ps | grep postgres

# Check logs
docker logs docker-postgres-1

# Reset database
npm run clean
npm run dev
```

### Redis Connection Failed

```bash
# Check Redis is running
docker ps | grep redis

# Test Redis directly
redis-cli -p 6379 ping
# Should return: PONG
```

### Tests Failing

```bash
# For chaos tests
npm run test:chaos:watch -- --reporter=verbose

# For E2E tests
npm run test:e2e:debug

# Check browser console (E2E)
# Screenshots saved in test-results/
ls test-results/
```

## Development Workflow

### Making Changes

1. **Edit code** in `apps/api/` or `apps/web/`
2. **Services auto-reload** (hot reload enabled)
3. **Run tests** to verify changes
4. **View results** in dashboard

### Running Locally vs Production

| Aspect | Local | Production |
|--------|-------|-----------|
| Data | Docker Postgres (ephemeral) | RDS/Cloud SQL (persistent) |
| Cache | Docker Redis | ElastiCache/Cloud Memorystore |
| Logs | Console output | CloudWatch/Cloud Logging |
| Auth | Dev tokens | OAuth/SAML |
| Splunk | Your instance | Production Splunk |

## Performance Tips

```bash
# Reduce build time (disable optimization)
NODE_ENV=development npm run dev

# Limit test parallelization
npm run test:e2e -- --workers=1

# Use watch mode for development
npm run test:chaos:watch
```

## Next Steps

- **First time?** → Follow Quick Start above
- **Want to test chaos scenarios?** → Run `npm run test:chaos`
- **Want to verify dashboard data integrity?** → Run `npm run test:e2e`
- **Ready to connect to Splunk?** → Open http://localhost:3002 and enter credentials
- **Need to see all documentation?** → Read SOURCE_OF_TRUTH.md

---

**Status**: All services containerized and ready to run locally  
**Last Updated**: 2026-05-19  
**Verification**: ✅ E2E tests passing (12/12)
