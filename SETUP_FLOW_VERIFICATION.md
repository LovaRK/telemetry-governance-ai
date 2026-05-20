# Setup Flow Verification Checklist

## The Bug (Now Fixed)
```
fetch('/api/cache-status')  // ❌ No Authorization header
                ↓
            401 Unauthorized
                ↓
      hasEverRefreshed = false
                ↓
    Page stuck on setup screen
```

## The Fix
Changed in `apps/web/app/page.tsx` line 76:
```typescript
apiFetch('/api/cache-status')  // ✅ WITH Authorization header
```

---

## Manual Verification Steps

### 1. Hard Reset Browser State
```javascript
// Open DevTools Console (F12) and run:
localStorage.clear();
sessionStorage.clear();
// Then: Refresh page
```

OR use DevTools GUI:
- Chrome DevTools → Application tab
- Left sidebar → Local Storage → Select localhost:3002 → Delete All
- Left sidebar → Session Storage → Select localhost:3002 → Delete All
- Left sidebar → Cookies → Select localhost:3002 → Delete All
- Reload page

### 2. Verify Login Token
After login (you should be redirected to setup page):
```javascript
// Open Console and run:
localStorage.getItem('access_token')
```

**Expected:** 
```
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**If null:** Login is broken, don't proceed.

### 3. Watch Network Requests
- Open DevTools → Network tab
- Filter for: `cache`
- Click "Connect & Refresh" button
- Fill in Splunk credentials:
  - URL: `https://144.202.48.85:8089`
  - Username: `ram`
  - Password: `Rama@1988`

**Expected requests (in order):**
```
POST /api/cache           → 200 OK
GET /api/cache-status     → 200 OK
```

**If seeing 401/403/500:**
Fix is not applied or token not being sent.

### 4. Inspect Response Payloads
Click the `/api/cache-status` request in Network tab:
- Go to "Response" tab
- Should show:
```json
{
  "data": {
    "hasEverRefreshed": true,
    "hasData": true,
    "hasAgentDecisions": true,
    ...
  }
}
```

**If `hasEverRefreshed: false`:**
Page will stay on setup screen.

### 5. Verify Dashboard Transition
After clicking "Connect & Refresh":

**Expected flow:**
```
Setup page (with form)
          ↓
     (button loading)
          ↓
   POST /api/cache 200
          ↓
   GET /api/cache-status 200
          ↓
  Dashboard (with tabs)
```

**Should happen within 30 seconds.**

**If stuck on setup page after 30s:**
- Check Network tab for failed requests
- Check Console for errors
- Look for 401 responses

### 6. Verify Data Integrity
Once on dashboard, ensure data is real (not hardcoded):

Check Network requests:
```
/api/executive-summary
/api/queue-health
/api/governance/cache-coherence
```

All should return **200** with real data.

Then verify in Database:
```sql
-- Connect to database
psql postgresql://telemetry:telemetry@localhost:5433/telemetry_os

-- Check if data exists
SELECT COUNT(*) FROM executive_kpis;
SELECT COUNT(*) FROM job_queue;
SELECT COUNT(*) FROM governance_mutation_journal;
```

Dashboard should show matching data.

### 7. Regression Test
Run the automated test:
```bash
npx playwright test tests/e2e/setup-flow.spec.ts
```

Should pass end-to-end in <60 seconds.

---

## Sign-off Checklist

- [ ] Step 1: Browser state cleared
- [ ] Step 2: Token exists in localStorage
- [ ] Step 3: Network shows 200 responses
- [ ] Step 4: Payload has hasEverRefreshed: true
- [ ] Step 5: Dashboard loads within 30s (not stuck)
- [ ] Step 6: Data matches database
- [ ] Step 7: Regression test passes

**If all 7 pass:** Bug is fixed. ✅

**If any fail:** Report which step failed + Network tab screenshot.
