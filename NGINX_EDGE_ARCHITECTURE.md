# NGINX Edge Architecture: Must-Do Implementation

## 🎯 Overview

This document captures the **edge-routed architecture** transformation from direct service access to production-grade NGINX reverse proxy as the system's entry point.

**What changed:** Your system now routes all external traffic through NGINX gateway instead of accessing services directly.

**Why:** Separates external interface (flexible, routable) from internal service contracts (immutable).

---

## 🔄 Architecture Transformation

### Before (Direct Access)
```
Browser
  ↓
localhost:3002 (WEB_PORT)
  ↓
Next.js web server :3000
  ↓
Database + API routes
```

**Problems:**
- No centralized routing
- No edge-level health checks
- Path rewriting impossible
- Security headers scattered
- No rate limiting
- Tests access service directly (bypass security layer)

### After (Edge-Routed)
```
Browser
  ↓
localhost:3003 (GATEWAY_PORT)
  ↓
NGINX gateway :80 (internal)
  ├─ Path rewriting (/api/* → /*)
  ├─ Security headers (XSS, clickjacking, type confusion)
  ├─ Timeout enforcement
  ├─ Rate limiting
  ├─ Health checks
  └─ Request logging
  ↓
web:3000 (internal Docker network)
```

**Benefits:**
- ✅ Centralized routing logic
- ✅ Edge-level health monitoring
- ✅ Production-grade security
- ✅ Test topology matches production
- ✅ Rate limiting at gateway
- ✅ Easy future upgrades (auth, observability, load balancing)

---

## 🔧 MUST-DO Fixes (All Implemented)

### Fix #1: Path Rewriting ✅
**Problem:** API calls to `/api/users` would become `/api/users` in upstream, causing `/api/api/users` ambiguity.

**Solution:** NGINX rewrite rule rewrites `/api/(.*)$` → `/$1`:
```nginx
location /api/ {
  rewrite ^/api/(.*)$ /$1 break;
  proxy_pass http://api_backend;
}
```

**Files:** `docker/nginx/nginx.conf` (lines 165-174)

---

### Fix #2: Timeouts ✅
**Problem:** Hanging connections (slow network, unresponsive upstream) block NGINX workers indefinitely.

**Solution:** Three-phase timeout configuration prevents hangs:
```nginx
proxy_connect_timeout 5s;    # Time to establish TCP connection
proxy_send_timeout 10s;      # Time to send request to upstream
proxy_read_timeout 10s;      # Time to receive response from upstream
```

**Impact:**
- Unresponsive upstream → 504 gateway timeout (failfast)
- Slow clients → Connection resets (prevent slowloris)
- Cascading failures isolated at gateway

**Files:** 
- `docker/nginx/nginx.conf` (lines 177-181 for API, 209-213 for web)
- `.env.development` (API_CONNECT_TIMEOUT, API_SEND_TIMEOUT, API_READ_TIMEOUT, etc.)

---

### Fix #3: Gateway Health Endpoint ✅
**Problem:** Load balancers/Kubernetes need to check if NGINX is responsive before routing traffic.

**Solution:** Two-tier health check:
```nginx
location = /health {
  # Edge-level health (NGINX itself is alive)
  return 200 '{"status":"ok"}';
}

location = /health/ready {
  # Upstream health (web service is ready)
  # Checks if web:3000/api/health is responding
}
```

**Usage:**
- Load balancer pings `GET /health` (is gateway alive?)
- Orchestrator pings `GET /health/ready` (is system ready?)

**Files:** `docker/nginx/nginx.conf` (lines 110-142)

---

### Fix #4: Playwright Tests Point to NGINX ✅
**Problem:** Tests were accessing web service directly (localhost:3002), bypassing gateway security & routing.

**Solution:** Tests now use GATEWAY_PORT (localhost:3003):
```typescript
// Before
const WEB_PORT = process.env.WEB_PORT || '3002';
baseURL: `http://localhost:${WEB_PORT}`

// After
const GATEWAY_PORT = process.env.GATEWAY_PORT || '3003';
baseURL: `http://localhost:${GATEWAY_PORT}`
```

**Impact:**
- Tests verify complete production topology
- Test failures surface routing issues early
- Tests validate security headers, timeouts, rate limiting

**Files:**
- `playwright.config.ts` (lines 1-28)
- `tests/e2e/global.setup.ts` (lines 1-95)

---

## 🚀 How to Use

### Start the System
```bash
# Pre-flight check (validates GATEWAY_PORT is available)
./scripts/check-ports.sh

# Start all services (NGINX + web + postgres + worker)
npm run dev

# You access at: http://localhost:3003 (NGINX gateway)
# Not: http://localhost:3002 (deprecated, no longer works)
```

### Run Tests
```bash
# Tests now access through NGINX gateway (localhost:3003)
npm run test:e2e

# Test flow:
# 1. global.setup.ts checks NGINX gateway health
# 2. Tests connect to localhost:3003
# 3. NGINX routes to web:3000 internally
# 4. Tests verify complete topology
```

### Override Gateway Port
```bash
# Use different port (no code changes needed)
GATEWAY_PORT=8080 npm run dev

# You access at: http://localhost:8080
# NGINX still routes to web:3000 internally
```

### View NGINX Logs
```bash
# See all requests flowing through gateway
docker logs dashboard_gateway

# See upstream responses
docker logs dashboard_web
```

---

## 📊 Implementation Files

| File | Change | Purpose |
|------|--------|---------|
| `docker/nginx/nginx.conf` | NEW | NGINX configuration with must-do fixes |
| `docker/Dockerfile.nginx` | NEW | NGINX Docker image |
| `docker/docker-compose.yml` | UPDATED | Added gateway service, web no longer exposed |
| `.env.development` | UPDATED | Added GATEWAY_PORT, documented deprecated WEB_PORT |
| `playwright.config.ts` | UPDATED | Uses GATEWAY_PORT instead of WEB_PORT |
| `tests/e2e/global.setup.ts` | UPDATED | Checks gateway health, not web service |
| `scripts/check-ports.sh` | UPDATED | Checks GATEWAY_PORT instead of WEB_PORT |

---

## 🔐 Security Headers Implemented

Each response includes:
```
X-Frame-Options: SAMEORIGIN          # Prevent clickjacking
X-Content-Type-Options: nosniff       # Prevent MIME sniffing
X-XSS-Protection: 1; mode=block       # Enable XSS filter
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

---

## ⚡ Strongly-Recommended Improvements

Not yet implemented, but should be considered:

### 1. Upstream Blocks (Future Load Balancing)
```nginx
upstream api_backend {
  server api:3001 weight=10;      # Primary
  server api-replica:3001 weight=5; # Replica
  keepalive 32;
}
```

**Current config:** Uses simplified `server web:3000`
**Future:** When API extracted to separate service, update to multiple upstreams

### 2. API_BASE Constant
Eliminate scattered `/api` hardcoded strings:
```typescript
// app/lib/api.ts
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api';

// Usage everywhere
const response = await fetch(`${API_BASE}/users`);
```

### 3. Rate Limiting Tuning
Current: `10r/s` per IP, `50r/s` for web

Consider:
- Endpoint-specific limits (/api/search might need more)
- Authenticated vs anonymous different limits
- Burst handling for legitimate spikes

---

## 🎯 Next Evolution Paths

The user offered to implement one of four architectural layers:

### 1. 🔧 Full Hardened nginx.conf
```
- Cache headers for static assets
- Connection pooling optimization
- Load balancing backend pool
- Graceful shutdown handling
- Upstream health check timeouts
```

### 2. ☸️ Kubernetes Ingress Equivalent
```
- 1:1 mapping from NGINX config to K8s Ingress resource
- Service discovery via DNS (web.default.svc.cluster.local)
- SSL/TLS termination at Ingress
- Horizontal pod autoscaling readiness
```

### 3. 📊 Observability Wiring
```
- NGINX → Prometheus metrics (request rate, latency, errors)
- NGINX → Loki logs (structured logging)
- Grafana dashboards (gateway health, upstream latency)
- Request tracing headers (X-Request-ID propagation)
```

### 4. 🔐 Auth Gateway Pattern
```
- JWT validation at NGINX level
- OAuth2 integration (implicit vs authorization code flow)
- Rate limiting by authenticated user (not just IP)
- API key management at gateway
- RBAC enforcement before routing to upstream
```

---

## 🛡️ Safety Checklist

- [x] NGINX path rewriting prevents `/api/api` ambiguity
- [x] Timeout configuration prevents hanging connections
- [x] Health endpoint at NGINX level (`:80/health`)
- [x] Tests point to GATEWAY_PORT (not deprecated WEB_PORT)
- [x] Security headers configured (X-Frame-Options, X-Content-Type-Options, etc.)
- [x] docker-compose.yml has gateway service
- [x] .env.development documents GATEWAY_PORT
- [x] scripts/check-ports.sh validates GATEWAY_PORT
- [x] Container network properly configured
- [ ] Rate limiting thresholds validated under load
- [ ] Upstream health check timeout tuned for your services
- [ ] Cache headers configured for static assets (recommended)

---

## 🧪 Testing the Architecture

### Manual Test: Gateway Health
```bash
curl http://localhost:3003/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Manual Test: Application Health
```bash
curl http://localhost:3003/health/ready
# Should return: 200 OK (if upstream is healthy)
# Should return: 503 Service Unavailable (if upstream is down)
```

### Manual Test: Path Rewriting
```bash
# Check that /api/* routes correctly
curl http://localhost:3003/api/health
# Should return application health (not 404)
```

### Manual Test: Security Headers
```bash
curl -i http://localhost:3003/
# Should contain:
# X-Frame-Options: SAMEORIGIN
# X-Content-Type-Options: nosniff
# X-XSS-Protection: 1; mode=block
```

### E2E Test: Complete Topology
```bash
npm run test:e2e
# Tests access via localhost:3003 (NGINX gateway)
# Tests verify path rewriting works
# Tests confirm security headers present
```

---

## 🔄 Deployment Path

### Local Development (Current)
```
npm run dev
# Starts: NGINX + web + postgres + worker
# Access: http://localhost:3003
```

### Docker Compose Production
```
docker-compose -f docker/docker-compose.yml up -d
# GATEWAY_PORT=80 (standard HTTP)
# Starts: NGINX + web + postgres + worker
# Access: http://your-server
```

### Kubernetes (Future - Ingress Pattern)
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dashboard
spec:
  rules:
  - host: example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: web
            port:
              number: 3000
```

---

## 📚 Related Documentation

- **PORT_STRATEGY.md** — Internal vs external contracts, immutable container ports
- **SOURCE_OF_TRUTH.md** — Canonical system architecture reference
- **RUN_LOCALLY.md** — Step-by-step local startup guide
- **INSTALLATION_GUIDE.md** — Prerequisites and full installation walkthrough

---

## ✨ Key Insight

> You're no longer just wiring ports—you're defining your edge architecture, and that's what determines whether your system behaves like a product or a collection of containers.

This NGINX gateway is the foundation for:
- 🔐 Future auth layer (OAuth, JWT at gateway)
- 📊 Observability (request tracing, metrics)
- ⚡ Rate limiting and DDoS protection
- 🔄 Graceful upgrades (blue-green, canary)
- ☸️ Kubernetes readiness (Ingress 1:1 mapping)

**The system is now production-grade.** 🚀
