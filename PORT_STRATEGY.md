# Port Strategy & Architecture

## 🧠 Core Principle

```
INTERNAL CONTRACTS MUST BE STABLE
EXTERNAL INTERFACES MUST BE FLEXIBLE
```

This single principle scales from local development to production Kubernetes.

---

## 📋 Port Contract Layers

### Layer 1: Internal Service Contract (IMMUTABLE)

```yaml
# These ports are part of the service's internal runtime contract
# Changing them requires code modifications
3000  - Next.js web server (embedded in Node.js process)
5432  - PostgreSQL database (embedded in PostgreSQL process)
6379  - Redis server (embedded in Redis process)
```

**Why they're immutable:**
- Hard-coded in service initialization
- Used by health checks
- Part of service discovery in future Kubernetes
- Reverse proxies expect these exact ports

**Breaking them causes:**
- Silent deployment failures
- Health checks hanging indefinitely
- Service mesh routing failures
- Cascading cascading failures in distributed systems

### Layer 2: Host Port Mapping (FLEXIBLE)

```yaml
ports:
  - "${WEB_PORT:-3002}:3000"        # HOST:CONTAINER
     ↑                 ↑
  variable        immutable
```

**This layer is configurable because:**
- Multiple services may run on same machine
- Developer might have port conflicts
- CI/CD pipelines use different port ranges
- Staging/prod sit behind load balancers (ports irrelevant)

### Layer 3: Environment Port Configuration (SINGLE SOURCE OF TRUTH)

```env
# .env.development - One place controls everything

WEB_PORT=3002           # Host port for web app
API_PORT=3001          # Host port for API
POSTGRES_PORT=5433     # Host port for PostgreSQL
REDIS_PORT=6379        # Host port for Redis
```

**Benefits:**
- ✅ Single source of truth
- ✅ No drift across files
- ✅ Easy CI/CD override (`WEB_PORT=8080 npm run dev`)
- ✅ Scales to multi-service architectures

---

## 🏗️ Current Architecture

```
┌──────────────────────────────────────────────────────────┐
│  DEVELOPER'S COMPUTER                                    │
│                                                          │
│  .env.development                                        │
│  ┌──────────────────────────────┐                       │
│  │ WEB_PORT=3002                │                       │
│  │ API_PORT=3001                │                       │
│  │ POSTGRES_PORT=5433           │                       │
│  │ REDIS_PORT=6379              │                       │
│  └──────────────────────────────┘                       │
│         ↓ ENV_VARS                                       │
│                                                          │
│  http://localhost:3002  ← Browser accesses here         │
│         ↓                                                │
│  ┌──────────────────────────────────────────────────┐  │
│  │  DOCKER NETWORK                                  │  │
│  │                                                   │  │
│  │  docker-compose.yml                              │  │
│  │  ┌──────────────────────┐                        │  │
│  │  │ ports:               │                        │  │
│  │  │  - "${WEB_PORT}:3000"                        │  │
│  │  └──────────────────────┘                        │  │
│  │         ↓                                          │  │
│  │  ┌─────────────────────────────────────────────┐ │  │
│  │  │  Next.js Web Container                      │ │  │
│  │  │  Internal port 3000 (IMMUTABLE)            │ │  │
│  │  │  ✓ Health check on :3000/api/health        │ │  │
│  │  │  ✓ Service discovery targets 3000          │ │  │
│  │  └─────────────────────────────────────────────┘ │  │
│  │         ↓                                          │  │
│  │  playwright.config.ts                            │  │
│  │  ┌──────────────────────────────────────────────┐│  │
│  │  │ baseURL = `http://localhost:${WEB_PORT}`    ││  │
│  │  │ (Reads from environment)                     ││  │
│  │  └──────────────────────────────────────────────┘│  │
│  │         ↓                                          │  │
│  │  ✅ Tests run against correct port               │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 🔐 Safety Guarantees

### ✅ Guaranteed Correct Behavior

1. **Container starts with fixed port 3000**
   ```yaml
   # docker-compose.yml
   # This is what Next.js listens on—it never changes
   3000 = INTERNAL SERVICE CONTRACT
   ```

2. **Host port is configurable**
   ```env
   # .env.development
   # Change this whenever needed, no code impact
   WEB_PORT=3002  # Can be 3005, 8080, 9999, etc.
   ```

3. **Tests use the configured port**
   ```ts
   // playwright.config.ts
   baseURL: `http://localhost:${process.env.WEB_PORT || 3002}`
   // Always reads from environment
   ```

4. **Services are healthy before tests start**
   ```ts
   // tests/e2e/global.setup.ts
   await waitForService(API_HEALTH_URL)
   // Prevents race conditions
   ```

### ✅ What's Impossible Now

```text
❌ Tests run against wrong port
   → Playwright reads from environment

❌ Port conflicts go undetected
   → check-ports.sh validates availability

❌ Services start but aren't ready
   → Healthcheck gate waits for readiness

❌ Config drift across files
   → Single source of truth in .env
```

---

## 📊 Implementation Files

| File | Purpose | Responsibility |
|------|---------|-----------------|
| `.env.development` | Single source of truth | Declare all port config |
| `docker-compose.yml` | Service definition | Map env vars to containers |
| `playwright.config.ts` | Test configuration | Read port from environment |
| `tests/e2e/global.setup.ts` | Test bootstrap | Verify service health |
| `scripts/check-ports.sh` | Validation | Detect port conflicts |

---

## 🚀 Usage Examples

### Standard Startup
```bash
npm run dev
# Uses WEB_PORT=3002 from .env.development
# Accesses at http://localhost:3002
```

### Custom Port (No Config File Edits)
```bash
WEB_PORT=8080 npm run dev
# Overrides .env.development
# Accesses at http://localhost:8080
# Tests auto-detect new port
```

### Pre-Flight Check
```bash
./scripts/check-ports.sh
# Validates all ports before starting
# ✅ Port 3002 available
# ✅ Port 3001 available
# ✅ Safe to run: npm run dev
```

### Run Tests
```bash
npm run test:e2e
# Global setup waits for health
# Tests run against configured port
# Prevents race conditions
```

---

## 🔄 How It Works: Detailed Flow

### Startup Sequence
```
1. Developer runs: WEB_PORT=3005 npm run dev
2. Docker reads env var: WEB_PORT=3005
3. docker-compose.yml substitutes: "3005:3000"
4. Container maps port 3005 → 3000
5. Next.js starts listening on 3000 inside container
6. Developer accesses http://localhost:3005
7. Host OS routes 3005 → Docker network → 3000
```

### Test Sequence
```
1. npm run test:e2e
2. playwright.config.ts reads: process.env.WEB_PORT
3. global.setup.ts checks health: http://localhost:${WEB_PORT}/api/health
4. Waits until 200 response
5. Tests run against same port
6. ✅ No race conditions
```

### Port Conflict Scenario
```
1. Developer: npm run dev (WEB_PORT=3002)
2. Port 3002 already in use by another process
3. Docker fails to bind
4. Error message tells user:
   "Port 3002 already in use by: Chrome PID: 12345"
   "To free: kill -9 12345"
5. Developer:
   kill -9 12345
   npm run dev
```

---

## 🎯 Production Alignment

This architecture scales to Kubernetes because it separates concerns:

### Local Dev
```
localhost:3002 → docker:3000
```

### Kubernetes
```
Pod:3000 → Service:80 → Ingress/LoadBalancer:443 → Client
```

**Same principle:** Internal contract (Pod:3000) is immutable, external interface (443) is variable.

---

## 🧩 Multi-Service Port Namespace (Future)

When you add more services:

```env
# .env.development - Growing port namespace

# Web frontend
WEB_PORT=3002

# Backend services
API_PORT=3001
WORKER_PORT=3010
HEALTH_CHECK_PORT=3011

# Data services
POSTGRES_PORT=5433
REDIS_PORT=6379

# Observability
GRAFANA_PORT=3001
PROMETHEUS_PORT=9090
JAEGER_PORT=6831

# Internal (immutable)
# WEB_INTERNAL=3000
# API_INTERNAL=3000
# POSTGRES_INTERNAL=5432
# REDIS_INTERNAL=6379
```

**This prevents:**
- Random port conflicts
- "Which port was that service on?" confusion
- Accidental hardcoded port dependencies

---

## 🛡️ Safety Checklist

- [ ] `.env.development` defines all host ports
- [ ] `docker-compose.yml` uses `${VAR}` for all ports
- [ ] `playwright.config.ts` reads from `process.env`
- [ ] `tests/e2e/global.setup.ts` validates health
- [ ] `scripts/check-ports.sh` runs before `npm run dev`
- [ ] Container ports (3000, 5432, 6379) are never changed
- [ ] No hard-coded port numbers in application code
- [ ] Port config tested across: local → CI → staging → prod

---

## 🔍 Validation Commands

```bash
# Check port availability
./scripts/check-ports.sh

# Verify env var is loaded
echo $WEB_PORT

# Check Docker mapping
docker ps --format "table {{.Names}}\t{{.Ports}}"

# Verify health endpoint
curl http://localhost:3002/api/health

# Test with custom port
WEB_PORT=9999 npm run dev
```

---

## 📚 Key Files

| File | Read When | Purpose |
|------|-----------|---------|
| `.env.development` | Setting up | Configure ports for local dev |
| `docker/docker-compose.yml` | Deploying | Understand service definitions |
| `playwright.config.ts` | Running tests | See how tests find services |
| `tests/e2e/global.setup.ts` | Debugging tests | Understand health gate |
| `scripts/check-ports.sh` | Port conflicts | Detect available ports |

---

## ✨ Outcome

```
✅ Deterministic configuration (one source of truth)
✅ No manual port sync across files
✅ Tests don't race with container startup
✅ Scales from local dev to Kubernetes
✅ Port conflicts detected early
✅ CI/CD can override ports easily (WEB_PORT=X npm run dev)
✅ Future services follow same pattern
```

This is enterprise-grade port management. 🚀
