# Production Safety Analysis - HEC Token & Endpoint Routing

## Your Scenarios

**Sandbox**: `https://144.202.48.85:8089`  
**Production**: `https://45.76.167.6:8089`

**Your Concern**: "If I push something with an HEC token, where will it go?"

---

## Current Architecture

### 1. **Separate URL Storage** ✅
The system stores three independent Splunk URLs per tenant:

```typescript
// From splunk-config-service.ts

interface SplunkConfig {
  apiUrl?: string;      // REST API endpoint (for queries)
  hecUrl?: string;      // HEC endpoint (for data ingestion)
  mcpUrl?: string;      // MCP endpoint (currently unused)
}
```

Each URL is stored separately in the database:
```sql
UPDATE tenants SET
  splunk_api_url = $1,   -- separate URL for REST API
  splunk_hec_url = $2,   -- separate URL for HEC
  splunk_mcp_url = $3    -- separate URL for MCP
WHERE id = $11
```

### 2. **Where HEC Token is Stored**

```typescript
// In tenants table:
splunk_hec_token    -- Stored unencrypted (security issue - see below)
splunk_hec_url      -- URL where this token will be sent
```

**CRITICAL**: HEC token is stored **unencrypted** in the database.

---

## Data Flow Analysis

### Flow 1: **Dashboard Reading Data** (Current Active)
```
Frontend (Browser)
    ↓
POST /api/cache-status
    ↓
Backend API (Node.js)
    ↓
SplunkClient.getIndexMetrics()
    ↓
HTTP GET $apiUrl/services/data/indexes
    Headers: Authorization: Basic {REST_AUTH_SECRET}
    ↓
Database has 144.202.48.85:8089 stored ✅
```

**Status**: Only reads Splunk. Uses REST API auth (BASIC), not HEC. Safe.

---

### Flow 2: **HEC Data Ingestion** (Test-only)
```
Frontend (Browser)
    ↓
POST /api/splunk/test-connection
    ↓
testSplunkConnection() in splunk-config-service.ts
    ↓
testHecEndpoint()
    ↓
POST $hecUrl/services/collector
    Headers: Authorization: Splunk {HEC_TOKEN}
    Body: { event: { message: "Test event from Dashboard" } }
    ↓
WHERE DOES THIS GO?
    If $hecUrl = 144.202.48.85:8089 → SANDBOX ✅
    If $hecUrl = 45.76.167.6:8089 → PRODUCTION ⚠️
```

**Status**: Currently HEC is **test-only**. Real data ingestion not implemented yet.

---

## The Risk

If you **later implement actual HEC data ingestion** and someone misconfigures:

```typescript
// Scenario: Developer mistake
const config: SplunkConfig = {
  apiUrl: 'https://144.202.48.85:8089',     // Sandbox (correct)
  hecUrl: 'https://45.76.167.6:8089',       // Production (WRONG!)
  hec_token: 'PROD_HEC_TOKEN'                // Production token
};
```

Then when the worker sends data:
```typescript
await fetch(`${config.hecUrl}/services/collector`, {
  headers: { Authorization: `Splunk ${config.hec_token}` },
  body: JSON.stringify(actualData)
});
// This will POST to production!!!
```

---

## Safety Controls - Current Status

### ✅ Already Implemented
1. **Separate URL Storage**: apiUrl, hecUrl, mcpUrl stored independently per tenant
2. **No Cross-URL Default**: If hecUrl is blank, it falls back to url, but this is explicit
3. **HEC is Optional**: Pipeline works without HEC token (REST API only)

### ⚠️ Missing / Needs Hardening

**ISSUE 1: No Endpoint Validation**
```typescript
// Currently: No check on URL during save
async saveSplunkConfig(tenant_id: string, config: SplunkConfig) {
  // ❌ Missing:
  // if (config.hecUrl.includes('45.76.167.6')) throw new Error('Production URL not allowed');
}
```

**ISSUE 2: HEC Token Stored Unencrypted**
```typescript
// In database:
splunk_hec_token = 'HEC_TOKEN_HERE'  // Plaintext ⚠️
splunk_rest_auth_secret = 'ENCRYPTED'  // Encrypted ✅
```

**ISSUE 3: No HEC Ingestion Implementation Yet**
The `/services/collector` endpoint is only tested, not actively used for data ingestion. Once you add that, you need guards.

---

## Recommendations

### Immediate (Prevent Accidental Production Pushes)

**1. Add Production URL Validation** (3-line fix)
```typescript
// apps/api/services/splunk-config-service.ts - saveSplunkConfig()

const PRODUCTION_IPS = ['45.76.167.6'];  // Add your production IPs

if (config.hecUrl) {
  for (const prodIp of PRODUCTION_IPS) {
    if (config.hecUrl.includes(prodIp)) {
      throw new Error(
        `Production URL blocked: HEC URL cannot be set to production (${prodIp}). ` +
        `This is a sandbox environment. Use 144.202.48.85:8089 instead.`
      );
    }
  }
}
```

**2. Encrypt HEC Token** (Use existing pattern)
```typescript
// apps/api/services/splunk-config-service.ts - saveSplunkConfig()

if (config.hec_token) {
  encryptedHecToken = encryptSecret(config.hec_token);  // Use same as restAuthSecret
}
```

**3. Separate HEC Validation Function**
```typescript
async validateHecUrl(hecUrl: string): Promise<void> {
  const BLOCKED_PATTERNS = [
    { ip: '45.76.167.6', name: 'PRODUCTION' },
    { ip: 'prod-splunk', name: 'PRODUCTION' },
  ];
  
  for (const pattern of BLOCKED_PATTERNS) {
    if (hecUrl.includes(pattern.ip)) {
      throw new Error(
        `❌ BLOCKED: Cannot configure HEC to ${pattern.name} endpoint (${pattern.ip}). ` +
        `Sandbox environment only accepts: 144.202.48.85:8089`
      );
    }
  }
}
```

---

### When You Add HEC Data Ingestion (Future)

```typescript
// Before sending data via HEC:

async sendViaHec(tenantId: string, event: any): Promise<void> {
  const config = await this.configService.getSplunkConfig(tenantId);
  
  // Validation 1: URL is not production
  if (!config.hecUrl.includes('144.202.48.85')) {
    throw new Error('HEC URL is not the authorized sandbox. Cannot proceed.');
  }
  
  // Validation 2: Token is not production token
  if (config.hec_token?.includes('PROD_')) {
    throw new Error('HEC token appears to be production token. Blocked.');
  }
  
  // Validation 3: Tenant is not marked as production
  const tenant = await this.db.query(
    'SELECT environment FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (tenant.environment === 'production') {
    throw new Error('Production tenant cannot use HEC in sandbox environment.');
  }
  
  // NOW send:
  await fetch(`${config.hecUrl}/services/collector`, {
    headers: { Authorization: `Splunk ${config.hec_token}` },
    body: JSON.stringify(event)
  });
}
```

---

## Current State: What's Safe RIGHT NOW

| Component | Status | Risk |
|-----------|--------|------|
| **REST API Queries** | ✅ Active | ✅ Safe - only reads from Splunk |
| **HEC Token Storage** | ⚠️ Active | ⚠️ Stored plaintext, but not used yet |
| **HEC Data Ingestion** | ❌ Not Implemented | N/A - test-only right now |
| **URL Validation** | ❌ Missing | ⚠️ Will matter once ingestion is active |

---

## Summary

**Your HEC token RIGHT NOW**:
- Stored in database at `tenants.splunk_hec_token`
- Paired with HEC URL in `tenants.splunk_hec_url` 
- Only used for **test connection** (POST to `/services/collector` with test event)
- Not used for actual data ingestion yet

**If you push data with your HEC token TODAY**:
- It will go to whatever `splunk_hec_url` is configured in the database
- Currently: `https://144.202.48.85:8089` (sandbox) ✅

**To prevent accidental production pushes**:
1. **Add URL validation** (block 45.76.167.6 at config save time)
2. **Encrypt HEC token** (like REST auth secret)
3. **Add environment checks** (prod tenant cannot use sandbox HEC)
4. **Separate test/prod HEC endpoints** (different credentials per environment)

---

## Test Matrix

```
Scenario 1: HEC token configured for sandbox
  apiUrl: 144.202.48.85:8089
  hecUrl: 144.202.48.85:8089
  hec_token: SANDBOX_TOKEN
  Result: ✅ Safe - data goes to sandbox

Scenario 2: Mixed config (DANGEROUS)
  apiUrl: 144.202.48.85:8089  (sandbox queries)
  hecUrl: 45.76.167.6:8089    (production ingestion!)
  hec_token: PROD_TOKEN
  Result: ❌ REST reads from sandbox, HEC writes to production!

Scenario 3: With proposed validation
  Scenario 2 attempted
  Validation: Detects 45.76.167.6, throws error
  Result: ✅ Configuration rejected before save
```

---

**Question for You**: Would you like me to implement the URL validation guards right now, or wait until actual HEC data ingestion is added?

