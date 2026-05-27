# Environment Safety Model - Two-Layer Protection

## Critical Objective

**Prevent synthetic/demo/test telemetry from accidentally reaching production Splunk infrastructure.**

---

## Architecture Overview

### Layer 1: Runtime Environment Separation

```
APP_ENV=sandbox
  ↓
EnvironmentValidator checks ALL URLs against allowlist
  ↓
Only approved hosts allowed
  ↓
Config validation BEFORE database save
```

### Layer 2: Explicit Host Allowlist (Whitelist, not Blacklist)

**SANDBOX MODE** (`APP_ENV=sandbox`):
```
ALLOWED HOSTS (whitelist):
  ✅ 144.202.48.85      ← ONLY production destination
  ✅ localhost
  ✅ 127.0.0.1
  ✅ host.docker.internal
  ✅ 0.0.0.0

BLOCKED HOSTS (defense-in-depth):
  ❌ 45.76.167.6        ← Production Splunk (explicitly blocked)
  ❌ prod
  ❌ production
  ❌ sem
  ❌ splunk-prod
```

**PRODUCTION MODE** (`APP_ENV=production`):
```
All valid URLs allowed
(Used only when deploying real operational environment)
```

---

## Implementation

### 1. Core Validator Module

**File**: `core/security/environment-validator.ts`

```typescript
export class EnvironmentValidator {
  validateSplunkUrl(urlString, purpose): { valid, reason? }
  validateAllSplunkUrls(apiUrl, hecUrl, mcpUrl): { valid, reasons[] }
  getEnvironmentMode(): 'sandbox' | 'production'
  getAllowedHosts(): string[]
  getBlockedHosts(): string[]
}
```

**Key Feature**: Validates URL BEFORE any network call or database write.

### 2. Integration Points

**apps/api/services/splunk-config-service.ts - saveSplunkConfig()**

```typescript
// SECURITY: Validate URLs against environment restrictions (Layer 1 & 2)
const urlValidation = environmentValidator.validateAllSplunkUrls(
  config.apiUrl || config.url,
  config.hecUrl || config.url,
  config.mcpUrl
);

if (!urlValidation.valid) {
  throw new Error(`URL Validation Failed:\n${urlValidation.reasons.join('\n')}`);
}

// Log approved URLs for audit trail (TEST 2.2)
console.log('[SPLUNK_CONFIG_SAVE]', {
  tenant_id,
  environment: environmentValidator.getEnvironmentMode(),
  apiUrl: config.apiUrl || config.url,
  hecUrl: config.hecUrl || config.url,
  timestamp: new Date().toISOString(),
});
```

This validation:
- ✅ Happens BEFORE database update
- ✅ Happens BEFORE any network call
- ✅ Logs all approved URLs (audit trail)
- ✅ Rejects with clear error message
- ✅ Returns HTTP 400 to frontend

### 3. Environment Configuration

**docker/.env.local**:
```env
# CRITICAL: Prevents synthetic demo telemetry from reaching production
APP_ENV=sandbox
```

**docker/docker-compose.yml**:
```yaml
services:
  web:
    environment:
      - APP_ENV=${APP_ENV:-sandbox}
  
  worker:
    environment:
      - APP_ENV=${APP_ENV:-sandbox}
```

---

## Test Matrix - MANDATORY VERIFICATION

### TEST GROUP 1: Configuration Safety

#### Test 1.1 - Sandbox URL Accepted
```
Input:  https://144.202.48.85:8089
Expected: SAVE SUCCESS

Command: 
  curl -X POST http://localhost:3002/api/splunk/config \
    -H "Content-Type: application/json" \
    -d '{
      "apiUrl": "https://144.202.48.85:8089",
      "hecUrl": "https://144.202.48.85:8089",
      "hec_token": "sandbox_token"
    }'

Expected Response: 200 OK, config saved
```

#### Test 1.2 - Production URL Blocked
```
Input:  https://45.76.167.6:8089
Expected: HTTP 400, "Production endpoint blocked in sandbox mode"

Command:
  curl -X POST http://localhost:3002/api/splunk/config \
    -H "Content-Type: application/json" \
    -d '{
      "apiUrl": "https://45.76.167.6:8089",
      "hecUrl": "https://45.76.167.6:8089",
      "hec_token": "prod_token"
    }'

Expected Response: 400 Bad Request
{
  "error": "URL Validation Failed (sandbox mode):\nAPI URL: 🚫 PRODUCTION ENDPOINT BLOCKED in sandbox mode"
}
```

#### Test 1.3 - Production HEC Blocked
```
Input:  https://45.76.167.6:8088
Expected: BLOCKED

Command: Same as 1.2 with port 8088
Expected Response: 400 Bad Request
```

#### Test 1.4 - Localhost Allowed
```
Input:  http://localhost:8089
Expected: ALLOWED

Command:
  curl -X POST http://localhost:3002/api/splunk/config \
    -H "Content-Type: application/json" \
    -d '{
      "apiUrl": "http://localhost:8089",
      "hecUrl": "http://localhost:8089",
      "hec_token": "local_token"
    }'

Expected Response: 200 OK (if Splunk is running locally)
```

---

### TEST GROUP 2: Runtime Routing Verification

#### Test 2.1 - Verify Active Splunk URL (Database Level)
```sql
SELECT
  splunk_api_url,
  splunk_hec_url,
  splunk_mcp_url
FROM tenants
WHERE id = 'default_tenant';

Expected:
  144.202.48.85  ← ONLY this IP
  NOT 45.76.167.6  ← NEVER this
```

#### Test 2.2 - Log Outbound Requests (Verification Logging)
```bash
# Watch backend logs during config save
docker logs web -f | grep -i "SPLUNK_CONFIG_SAVE\|SECURITY"

# During config save, expect:
[SPLUNK_CONFIG_SAVE] {
  "tenant_id": "default",
  "environment": "sandbox",
  "apiUrl": "https://144.202.48.85:8089",
  "hecUrl": "https://144.202.48.85:8089",
  "timestamp": "2026-05-27T..."
}

Expected: 144.202.48.85 ONLY
Never: 45.76.167.6
```

#### Test 2.3 - Network-Level Verification
```bash
# Monitor actual outbound requests during refresh
docker logs worker -f | grep -i "POST\|https://"

Expected:
POST https://144.202.48.85/services/collector
GET https://144.202.48.85/services/data/indexes

Never:
POST https://45.76.167.6
GET https://45.76.167.6
```

---

### TEST GROUP 3: Data Isolation

#### Test 3.1 - Inject Fake Telemetry
```bash
# During demo run, inject synthetic marker
# (In real implementation, this would be in telemetry)

Synthetic event:
{
  "source": "demo-test",
  "message": "THIS_IS_SYNTHETIC",
  "timestamp": "2026-05-27T00:00:00Z"
}

Expected: Appears ONLY in sandbox Splunk
```

#### Test 3.2 - Search Production for Synthetic Data
```spl
# In production Splunk, search for our synthetic marker
index=* THIS_IS_SYNTHETIC

Expected Results: 0 events

Reason: Our validator prevents any POST to production HEC,
        so synthetic data never leaves sandbox
```

---

### TEST GROUP 4: Environment Guardrails

#### Test 4.1 - Sandbox Mode Blocks Production
```bash
# Set sandbox mode
export APP_ENV=sandbox

# Attempt to save production URL
# Expected: REJECTED before database write

# Verify in logs:
docker logs web -f | grep "SECURITY\|BLOCKED"

Expected: [SECURITY] URL Validation Failed... PRODUCTION ENDPOINT BLOCKED
```

#### Test 4.2 - Production Mode Allows Production
```bash
# Set production mode (DO NOT DO THIS IN DEMO!)
export APP_ENV=production

# Now production URLs would be allowed
# This is for actual production deployment only
```

---

## Safety Guarantees

### Guarantee 1: Configuration Time Protection
✅ URL validation happens BEFORE database save  
✅ Rejection is immediate with clear error  
✅ No partial saves or invalid states  

### Guarantee 2: Runtime Protection
✅ Every Splunk operation reads validated URLs from database  
✅ Logging captures which URLs are being used  
✅ Environment mode enforced at boot time  

### Guarantee 3: Defense in Depth
✅ Both allowlist AND blocklist (defense in depth)  
✅ Multiple validation points (config save + HEC test)  
✅ Clear error messages guide users to correct URL  

---

## Error Messages (User-Facing)

### Scenario 1: User accidentally enters production URL
```
HTTP 400 Bad Request

🚫 PRODUCTION ENDPOINT BLOCKED in sandbox mode
Host "45.76.167.6" is not allowed.
Blocked pattern: "45.76.167.6"

Sandbox can ONLY use: 144.202.48.85, localhost, 127.0.0.1, host.docker.internal
```

### Scenario 2: User enters unknown host
```
HTTP 400 Bad Request

🔒 SANDBOX RESTRICTION: Host "random-host.com" not in allowlist
Approved hosts: 144.202.48.85, localhost, 127.0.0.1, host.docker.internal
```

---

## Audit Trail

Every config save logs:
```json
[SPLUNK_CONFIG_SAVE] {
  "tenant_id": "default",
  "environment": "sandbox",
  "apiUrl": "https://144.202.48.85:8089",
  "hecUrl": "https://144.202.48.85:8089",
  "mcpUrl": "https://144.202.48.85:8089",
  "timestamp": "2026-05-27T10:30:45.123Z"
}
```

Every security violation logs:
```
[SECURITY] URL Validation Failed (sandbox mode):
HEC URL: 🚫 PRODUCTION ENDPOINT BLOCKED in sandbox mode
API URL: 🔒 SANDBOX RESTRICTION: Host "45.76.167.6" not in allowlist
```

---

## UI Banner (For Operator Awareness)

*To be added to dashboard header in future*:
```
╔════════════════════════════════════════════════════════════════╗
║ 🔒 SANDBOX MODE ACTIVE                                         ║
║ Telemetry writes restricted to approved hosts (144.202.48.85)  ║
║ Production URLs (45.76.167.6) are blocked                      ║
╚════════════════════════════════════════════════════════════════╝
```

This prevents operator mistakes during external demos.

---

## Deployment Checklist

Before any external demo:

- [ ] APP_ENV=sandbox in docker-compose.yml
- [ ] APP_ENV=sandbox in .env.local
- [ ] EnvironmentValidator loaded at startup
- [ ] URL validation integrated in saveSplunkConfig()
- [ ] Tests passing (environment-safety.test.ts)
- [ ] Logging verified (can see [SPLUNK_CONFIG_SAVE] in logs)
- [ ] Production URL (45.76.167.6) blocked (TEST 1.2)
- [ ] Sandbox URL (144.202.48.85) accepted (TEST 1.1)
- [ ] No synthetic data in production Splunk (TEST 3.2)

---

## Files Modified/Created

**Created**:
- `core/security/environment-validator.ts` (90 lines)
- `tests/integration/environment-safety.test.ts` (comprehensive test suite)

**Modified**:
- `apps/api/services/splunk-config-service.ts` (added validation)
- `docker/docker-compose.yml` (added APP_ENV)
- `docker/.env.local` (added APP_ENV=sandbox)

**Total Lines of Code Added**: ~150 lines (validator) + ~500 lines (tests)
**Risk Level**: 🟢 MINIMAL - Validation only, no architecture changes
**Safety Impact**: 🔴 CRITICAL - Prevents production data breach

