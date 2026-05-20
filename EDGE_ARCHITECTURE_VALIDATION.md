# Edge Architecture Validation Checklist

## ✅ MUST-DO Fixes Status

### 1. Path Rewriting Implementation
**Status:** ✅ COMPLETE

**File:** `docker/nginx/nginx.conf` lines 165-174
```nginx
location /api/ {
  limit_req zone=api_limit burst=20 nodelay;
  rewrite ^/api/(.*)$ /$1 break;  # ← MUST-DO FIX
  proxy_pass http://api_backend;
}
```

**Validation:**
```bash
# Test that /api/* is rewritten to /* upstream
curl -v http://localhost:3003/api/health
# Should show request to web:3000 with /health path (not /api/health)
```

**Why critical:** Without this, API calls become `/api/api/users` in upstream, causing routing errors.

---

### 2. Timeout Configuration
**Status:** ✅ COMPLETE

**Files:**
- `docker/nginx/nginx.conf` lines 177-181 (API) and 209-213 (web)
- `.env.development` lines 47-55 (environment variables)

**Implementation:**
```nginx
# For API endpoints
proxy_connect_timeout ${API_CONNECT_TIMEOUT:-5s};   # ← MUST-DO
proxy_send_timeout ${API_SEND_TIMEOUT:-10s};        # ← MUST-DO
proxy_read_timeout ${API_READ_TIMEOUT:-10s};        # ← MUST-DO

# For web service
proxy_connect_timeout ${WEB_CONNECT_TIMEOUT:-5s};
proxy_send_timeout ${WEB_SEND_TIMEOUT:-10s};
proxy_read_timeout ${WEB_READ_TIMEOUT:-10s};
```

**Validation:**
```bash
# Monitor for timeout behavior
docker logs -f dashboard_gateway | grep -i "timeout\|504"

# Test unresponsive upstream (simulated)
# Kill web container while requests are in flight
docker stop dashboard_web
# NGINX should return 504 after 10s (read timeout)
```

**Why critical:** Prevents "hanging requests" that block NGINX workers and cause cascading failures.

---

### 3. Health Check Endpoint
**Status:** ✅ COMPLETE

**File:** `docker/nginx/nginx.conf` lines 110-142

**Implementation:**
```nginx
# Edge-level health (NGINX itself)
location = /health {
  access_log off;
  default_type application/json;
  return 200 '{"status":"ok","timestamp":"$date_gmt"}';
}

# Upstream health (web service readiness)
location = /health/ready {
  access_log off;
  # Checks if web:3000/api/health is responding
  access_by_lua_block {
    local http = require("resty.http")
    local httpc = http.new()
    local ok, code = httpc:request_uri("http://web:3000/api/health", {
      method = "GET",
      connect_timeout = 1000,
    })
    if ok and code == 200 then
      ngx.exit(200)
    else
      ngx.exit(503)
    end
  }
}
```

**Validation:**
```bash
# Gateway itself alive
curl http://localhost:3003/health
# Returns: {"status":"ok","timestamp":"Mon, 19 May 2026 12:00:00 GMT"}

# Upstream service ready
curl http://localhost:3003/health/ready
# Returns: 200 OK if web is healthy
# Returns: 503 Service Unavailable if web is down
```

**Why critical:** Load balancers and orchestrators depend on health endpoints to route traffic safely.

---

### 4. Playwright Tests Use GATEWAY_PORT
**Status:** ✅ COMPLETE

**Files:**
- `playwright.config.ts` lines 24-28 (baseURL configuration)
- `tests/e2e/global.setup.ts` lines 1-95 (health gate)

**Implementation:**
```typescript
// Before
const WEB_PORT = process.env.WEB_PORT || '3002';
baseURL: `http://localhost:${WEB_PORT}`

// After
const GATEWAY_PORT = process.env.GATEWAY_PORT || '3003';
baseURL: `http://localhost:${GATEWAY_PORT}`
```

**Health gate now checks:**
```typescript
const GATEWAY_HEALTH_URL = `http://localhost:${GATEWAY_PORT}/health`;
const APP_HEALTH_URL = `http://localhost:${GATEWAY_PORT}/api/health`;

// Waits for both before running tests
await waitForService(GATEWAY_HEALTH_URL, 'Gateway health');
await waitForService(APP_HEALTH_URL, 'Application health');
```

**Validation:**
```bash
# Run tests (will use localhost:3003)
npm run test:e2e

# Should see in output:
# "📍 Checking NGINX gateway on http://localhost:3003..."
# "⏳ Waiting for NGINX gateway to be responsive..."
# "⏳ Waiting for upstream services to be healthy..."
# "✅ All services ready for testing"
```

**Why critical:** Tests now verify complete production topology, not just direct service access.

---

## 🔧 Additional Implementations

### Updated docker-compose.yml
**Status:** ✅ COMPLETE

**Key changes:**
1. **New gateway service** (lines 7-45):
   - Builds NGINX image
   - Exposes GATEWAY_PORT (3003 for dev, 80 for prod)
   - Routes environment variables to NGINX
   - Depends on web service
   - Has healthcheck

2. **Web service updated** (lines 55-97):
   - NO PORTS exposed (traffic via NGINX only)
   - Container name: dashboard_web
   - Healthcheck on internal port 3000
   - Joined to dashboard_network

3. **Network added** (lines 168-170):
   - dashboard_network bridge network
   - All services on same network
   - Internal service-to-service routing

### Updated .env.development
**Status:** ✅ COMPLETE

**Key additions:**
```env
# New in edge architecture
GATEWAY_PORT=3003

# Timeout configuration
API_CONNECT_TIMEOUT=5s
API_SEND_TIMEOUT=10s
API_READ_TIMEOUT=10s

# Security headers
SECURITY_FRAME_OPTIONS=SAMEORIGIN
SECURITY_CONTENT_TYPE_OPTIONS=nosniff
SECURITY_XSS_PROTECTION=1; mode=block
```

### Updated check-ports.sh
**Status:** ✅ COMPLETE

**Changes:**
1. Checks GATEWAY_PORT instead of WEB_PORT
2. Explains external vs internal ports
3. Shows architecture flow on success
4. Architecture diagram:
```
http://localhost:3003 (you access here)
       ↓
NGINX gateway (path rewriting, security headers, timeouts)
       ↓
web:3000 (internal Docker network)
```

---

## 🧪 Pre-Deployment Validation Commands

### 1. Syntax Check NGINX Config
```bash
# Build NGINX image (validates syntax)
docker build -f docker/Dockerfile.nginx -t dashboard-nginx:latest .

# If it succeeds, nginx.conf syntax is valid
# If it fails, error message will show the line
```

### 2. Port Availability Check
```bash
./scripts/check-ports.sh
# Should show:
# ✅ Port 3003 (NGINX Gateway) available
# ✅ Safe to run: npm run dev
```

### 3. Start Services
```bash
npm run dev
# Should start: gateway (NGINX) + web + postgres + worker
# No errors in any service logs
```

### 4. Manual Endpoint Tests
```bash
# Test gateway health
curl http://localhost:3003/health
# Expected: {"status":"ok","timestamp":"..."}

# Test app health through gateway
curl http://localhost:3003/api/health
# Expected: {...health response...}

# Test path rewriting (GET /api/anything should be rewritten to /anything)
curl -v http://localhost:3003/api/health 2>&1 | grep "GET /api"
# Should show: GET /api/health HTTP/1.1 (at NGINX)
# Upstream receives: GET /health (after rewrite)
```

### 5. Security Headers Check
```bash
curl -i http://localhost:3003/ | grep -E "X-Frame|X-Content|X-XSS"
# Should show:
# x-frame-options: SAMEORIGIN
# x-content-type-options: nosniff
# x-xss-protection: 1; mode=block
```

### 6. Run E2E Tests
```bash
npm run test:e2e
# Should:
# 1. Check gateway health on localhost:3003
# 2. Wait for upstream readiness
# 3. Run all tests via NGINX
# 4. All tests pass with production topology
```

---

## ⚠️ Common Issues & Fixes

### Issue #1: "Connection refused on port 3003"
**Cause:** NGINX container not started or crashed

**Fix:**
```bash
docker logs dashboard_gateway
# Check for errors in NGINX startup
# Common: nginx.conf syntax error (check line numbers in error)
```

### Issue #2: "Upstream timed out (504 Bad Gateway)"
**Cause:** Web service not healthy when NGINX tries to route

**Fix:**
```bash
# Check web service health
docker logs dashboard_web | tail -20
# Should see: "✅ Service healthy"

# Wait longer for startup
docker exec dashboard_gateway curl http://web:3000/api/health
# If this fails, web service is not ready
```

### Issue #3: "API requests get 404 (path not rewritten)"
**Cause:** Rewrite rule not matching or not applied

**Fix:**
```bash
# Check NGINX access logs
docker logs dashboard_gateway | grep /api

# Verify rewrite rule is in config
docker exec dashboard_gateway cat /etc/nginx/nginx.conf | grep -A3 "rewrite ^/api"
# Should show: rewrite ^/api/(.*)$ /$1 break;
```

### Issue #4: "Playwright can't find GATEWAY_PORT"
**Cause:** .env.development not being loaded by playwright.config.ts

**Fix:**
```bash
# Verify env var is set
echo $GATEWAY_PORT
# Should output: 3003

# Force-load in playwright.config.ts
require('dotenv').config({ path: '.env.development' });

# Run tests with explicit port
GATEWAY_PORT=3003 npm run test:e2e
```

---

## 📋 Pre-Production Checklist

Before deploying to production, ensure:

- [ ] NGINX config syntax validated (`docker build` succeeds)
- [ ] GATEWAY_PORT available on target machine
- [ ] All four must-do fixes verified (using commands above)
- [ ] Tests pass on complete topology
- [ ] Security headers present in responses
- [ ] Health endpoints respond correctly
- [ ] Timeout configuration matches your upstream latencies
- [ ] Rate limiting thresholds tested under expected load
- [ ] Logs are being captured (for debugging)
- [ ] Observability integrated (if needed)

---

## 🚀 Next Steps

Once this validation passes, you can proceed to:

1. **Strongly-Recommended Improvements:**
   - [ ] Add upstream blocks for future load balancing
   - [ ] Create API_BASE constant in application
   - [ ] Tune rate limiting thresholds

2. **Next Evolution (Pick One):**
   - [ ] Full hardened nginx.conf (caching, optimization)
   - [ ] Kubernetes Ingress equivalent (K8s readiness)
   - [ ] Observability wiring (Prometheus + Loki)
   - [ ] Auth gateway pattern (JWT/OAuth at edge)

---

## 📚 Validation Quick Reference

| Check | Command | Expected |
|-------|---------|----------|
| NGINX syntax | `docker build -f docker/Dockerfile.nginx .` | Succeeds without errors |
| Port available | `./scripts/check-ports.sh` | ✅ Port 3003 available |
| Gateway health | `curl http://localhost:3003/health` | 200 OK + JSON |
| App health | `curl http://localhost:3003/api/health` | 200 OK + app response |
| Security headers | `curl -i http://localhost:3003/` | X-Frame-Options present |
| Path rewrite | `curl -v http://localhost:3003/api/health` | GET / in upstream |
| Tests | `npm run test:e2e` | All tests pass |

**System is production-ready once all checks pass.** ✅
