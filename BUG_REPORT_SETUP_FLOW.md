# Bug Report: Setup Page Stuck After "Connect & Refresh"

## Incident Summary
**Status:** FIXED  
**Root Cause:** Missing Authorization header on cache-status request  
**Severity:** Critical (blocks UI flow)  
**Time to Diagnose:** Multiple iterations required careful API tracing  
**Time to Fix:** 1 line change  

---

## The Symptom
User clicks "Connect & Refresh" on setup page:
- Button shows loading state
- After ~5 minutes: page returns to setup screen
- No error message shown
- Appears to be a Splunk connection timeout
- Actually: UI is stuck waiting for hasEverRefreshed=true

---

## Root Cause Analysis

### The Bug Chain
```
User clicks "Connect & Refresh"
         ↓
apiFetch('/api/cache') — 200 OK ✅
         ↓
fetchSummary() runs
         ↓
fetch('/api/cache-status') — NO Authorization header ❌
         ↓
Server returns 401 Unauthorized
         ↓
Silently caught in try-catch
         ↓
setCacheStatus() never called
         ↓
cacheStatus.hasEverRefreshed stays undefined
         ↓
Conditional on line 210: if (!cacheStatus?.hasEverRefreshed)
         ↓
Component re-renders setup screen
         ↓
User sees setup page again
         ↓
Appears to be broken, but actually working correctly
```

### The Code

**File:** `apps/web/app/page.tsx`  
**Line:** 76  

```typescript
// ❌ BEFORE (BROKEN)
const statusRes = await fetch('/api/cache-status');

// ✅ AFTER (FIXED)
const statusRes = await apiFetch('/api/cache-status');
```

### Why This Works
- `fetch()` = plain HTTP, no headers added
- `apiFetch()` = authenticated fetch, automatically adds JWT from localStorage

After login:
```javascript
localStorage.setItem('access_token', response.data.accessToken);
```

So `apiFetch` can read it and include in `Authorization: Bearer ...` header.

---

## Why Diagnosis Was Hard

### API Tests Showed Success
```bash
curl -H "Authorization: Bearer $TOKEN" /api/cache-status → 200 OK
```

API itself was fine. But browser-side `fetch()` without auth header failed.

### Browser Console Showed Nothing
```javascript
// No errors logged
// Request silently failed in try-catch
// Component just re-rendered
```

### Network Tab Required
The smoking gun was in DevTools → Network tab:
```
GET /api/cache-status
Status: 401 Unauthorized
```

This only visible when tested in actual browser, not via curl.

### The 5-Minute Timeout
JWT expiry (900 seconds = 15 minutes) created the false impression:
- User clicks button at T=0
- Request fails immediately (401)
- But UI shows loading state for ~5 minutes
- Then finally times out and resets

This made it look like Splunk was slow when actually it was JWT/auth issue.

---

## Lessons

### 1. **Test in Real Browser**
Curl tests ≠ browser tests. Network layer differences.

### 2. **Authorization Headers Matter**
Two functions:
- `fetch()` - raw, requires manual headers
- `apiFetch()` - authenticated, auto-adds JWT

Using the wrong one silently fails.

### 3. **Silent Error Handling**
The try-catch caught the 401 without logging it. 
Should have logged:
```typescript
catch (e) {
  console.error('Failed to fetch cache status:', e);
  setError(...);
}
```

### 4. **DevTools Network Tab is Gold**
This bug was invisible without it. Always check:
- Request headers (Authorization?)
- Response status (401? 403? 500?)
- Response body (error message?)

### 5. **State Drift Masquerades as Bugs**
The "stuck forever" appearance was actually:
- Correct error handling
- Correct state management
- But wrong precondition (missing auth)

---

## Prevention

### Added
- ✅ Regression test: `tests/e2e/setup-flow.spec.ts`
- ✅ Manual verification checklist: `SETUP_FLOW_VERIFICATION.md`

### Should Add
- [ ] Console warning if apiFetch gets 401
- [ ] UI error toast on fetchSummary failure
- [ ] Integration test coverage for authenticated API calls

---

## Confidence Assessment

**Before:** 15% it was fetch() vs apiFetch()
**After:** 99% this was the bug

**Remaining 1%:** Other unauthenticated calls hidden by this one.

**How to catch it:** Run regression test on any changes to apiFetch or fetch patterns.

