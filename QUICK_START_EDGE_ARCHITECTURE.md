# Quick Start: Edge-Routed Architecture

**TL;DR:** Your system now routes through NGINX. Change one thing: access at **localhost:3003** (was 3002).

---

## 🚀 Start the System (30 seconds)

```bash
# Check if port 3003 is available
./scripts/check-ports.sh

# Start all services (NGINX + web + postgres + worker)
npm run dev

# Wait ~15 seconds for services to start
# Then open browser: http://localhost:3003
```

That's it. NGINX gateway routes all traffic internally.

---

## 🔍 What Changed

### Before
```
You → localhost:3002 → Next.js :3000
```

### After
```
You → localhost:3003 (NGINX) → Next.js :3000 (internal)
                ↓
         • Path rewriting (/api/* → /*)
         • Security headers
         • Timeouts
         • Rate limiting
         • Health checks
```

---

## ✅ Verify It's Working

### 1. Gateway is alive
```bash
curl http://localhost:3003/health
# Returns: {"status":"ok","timestamp":"..."}
```

### 2. App is healthy
```bash
curl http://localhost:3003/api/health
# Returns: {...health data...}
```

### 3. Security headers present
```bash
curl -i http://localhost:3003/ | head -20
# Should show X-Frame-Options, X-Content-Type-Options, X-XSS-Protection
```

### 4. Tests pass
```bash
npm run test:e2e
# Tests access via localhost:3003 (NGINX gateway)
# All E2E tests should pass
```

---

## 🔧 The Four Must-Do Fixes (What You Got)

| Fix | What | Why |
|-----|------|-----|
| **Path Rewriting** | `/api/*` becomes `/*` at upstream | Prevents `/api/api/*` routing errors |
| **Timeouts** | 5s connect, 10s send/read | Prevents hanging connections |
| **Health Endpoint** | `GET /health` at edge | Orchestrators can check if gateway is alive |
| **Playwright via NGINX** | Tests use port 3003, not 3002 | Tests verify complete production topology |

---

## 🎯 Common Tasks

### Access the App
```bash
# Open in browser or curl
curl http://localhost:3003/
```

### Override Gateway Port (CI/CD)
```bash
GATEWAY_PORT=8080 npm run dev
# Access at: http://localhost:8080
# NGINX still routes to web:3000 internally
```

### View NGINX Logs
```bash
docker logs -f dashboard_gateway
```

### View Web Logs
```bash
docker logs -f dashboard_web
```

### Stop Everything
```bash
npm run stop
# or manually
docker-compose -f docker/docker-compose.yml down
```

### Reset Database
```bash
docker volume rm dashboard_postgres_data
npm run dev
# Fresh database on next start
```

---

## 🧪 Run Tests

```bash
# Simple test run
npm run test:e2e

# Watch mode (auto-rerun on changes)
npm run test:e2e:watch

# Interactive UI
npm run test:e2e:ui

# Debug single test
npm run test:e2e:debug
```

Tests now run through NGINX gateway (localhost:3003), just like production. ✅

---

## ❌ Something Not Working?

### Gateway won't start
```bash
# Check port 3003 is available
lsof -i :3003

# Check NGINX syntax
docker build -f docker/Dockerfile.nginx -t test:latest .

# View error logs
docker logs dashboard_gateway
```

### Tests fail with 504 Bad Gateway
```bash
# Web service not healthy
docker logs dashboard_web

# Wait a bit longer (web takes ~30s to start)
sleep 30
npm run test:e2e
```

### Security headers missing
```bash
# NGINX config not loading
docker exec dashboard_gateway nginx -T
# Should show your config
```

### Can't access http://localhost:3003
```bash
# Check NGINX is running
docker ps | grep gateway

# Check port is exposed
docker port dashboard_gateway
# Should show: 80/tcp -> 0.0.0.0:3003
```

---

## 📚 Full Documentation

- **NGINX_EDGE_ARCHITECTURE.md** — Why this matters, how it works
- **EDGE_ARCHITECTURE_VALIDATION.md** — Detailed validation & troubleshooting
- **PORT_STRATEGY.md** — Port mapping principles & stability
- **SOURCE_OF_TRUTH.md** — Complete system architecture

---

## 🎯 What's Next?

Once this is working, the user can implement one of:

1. **Full Hardened NGINX** — Caching, optimization, load balancing
2. **Kubernetes Ingress** — 1:1 mapping to K8s resources
3. **Observability** — Prometheus metrics + Loki logs
4. **Auth Gateway** — JWT/OAuth validation at edge

---

## 💡 One More Thing

The edge architecture is now your system's **contract layer**:
- Internal (web:3000) → immutable, never change
- External (localhost:3003) → flexible, route anywhere
- Test topology → matches production exactly

This is enterprise-grade infrastructure. The hard part is done. ✅

**Questions? Check EDGE_ARCHITECTURE_VALIDATION.md for detailed troubleshooting.**
