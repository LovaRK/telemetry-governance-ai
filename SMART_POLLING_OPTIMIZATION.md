# Smart Polling Optimization - Implementation Complete

## Summary
Replaced fixed 5-second polling with intelligent, state-aware polling that:
- **Polls every 3 seconds** while pipeline is actively RUNNING/PARTIAL
- **Polls every 60 seconds** when pipeline is READY/FAILED/IDLE
- **Pauses completely** when browser tab is hidden (document.hidden)
- **Resumes intelligently** when tab becomes visible again

## Architecture

### New Hook: `use-smart-polling.ts`
**Location**: `/apps/web/lib/use-smart-polling.ts`

**Behavior**:
```typescript
const FAST_INTERVAL = 3000;    // 3 seconds (RUNNING/PARTIAL)
const SLOW_INTERVAL = 60000;   // 60 seconds (READY/FAILED/IDLE)

if (document.hidden) {
  // Pause polling entirely
  clearInterval();
}

const interval = 
  pipelineStatus === 'RUNNING' || pipelineStatus === 'PARTIAL'
    ? FAST_INTERVAL
    : SLOW_INTERVAL;
```

### Integrated Locations

#### 1. Dashboard State Polling (Lines 544-552)
**Old**: `useEffect` with fixed 5000ms interval
**New**: `useSmartPolling(dashboardPollCallback, lifecycleLlmStatus, shouldPollDashboard)`
- Polls aggressively (3s) when LLM is RUNNING
- Slow polls (60s) when LLM is READY/IDLE
- Pauses when tab hidden

#### 2. AI Inspector Polling (Lines 742-756)
**Old**: `useEffect` with fixed 5000ms interval and immediate tick
**New**: 
- Immediate load via `useEffect` on mount
- `useSmartPolling(aiInspectorPollCallback, pipelineStatus, aiInspectorOpen)`
- Converts `pipelineRun.status` to poll-rate status ('RUNNING' → 3s, else → 60s)

## Implementation Details

### State-Aware Polling
The hook monitors pipeline status and adjusts polling frequency:

```
pipelineStatus: 'RUNNING' or 'PARTIAL'
  → interval = 3000ms (aggressive monitoring)
  → Reason: User is actively running pipeline, show progress

pipelineStatus: 'READY' or 'FAILED' or 'IDLE'
  → interval = 60000ms (background monitoring)
  → Reason: Pipeline not active, background sync sufficient

pipelineStatus: null or unknown
  → polling disabled
  → Reason: Unknown state, don't poll
```

### Visibility-Aware Polling
Monitors `document.visibilitychange` event:

```javascript
if (document.hidden === true) {
  // Tab is in background → pause polling
  clearInterval();
}

if (document.hidden === false) {
  // Tab is visible again → resume with appropriate interval
  startPolling(getPollInterval(status));
}
```

### Benefits

| Metric | Before | After | Impact |
|--------|--------|-------|--------|
| Requests/hour (READY) | 720 (5s) | 60 (60s) | **92% reduction** |
| Requests/hour (RUNNING) | 720 (5s) | 1200 (3s) | +67% (justified - user watching) |
| API load (idle state) | High | Very Low | ✅ Demo-safe |
| User perception | Fixed refresh | Smart/responsive | ✅ Feels faster when running |
| Battery drain | Moderate | Minimal | ✅ Tab hidden = no polling |
| UX responsiveness | Good | Excellent | ✅ 3s during active work |

## Verification Checklist

### Test Case 1: Aggressive Polling During RUNNING
1. Trigger "Connect & Refresh" in dashboard
2. Open browser DevTools Network tab
3. Observe API calls every 3 seconds while `pipelineStatus === 'RUNNING'`
4. ✅ Expected: `/api/cache-status` and `/api/job-status/*` every 3s

### Test Case 2: Slow Polling After Completion
1. Wait for pipeline to complete (status → READY)
2. Observe API calls slow down
3. ✅ Expected: `/api/cache-status` every 60 seconds only

### Test Case 3: Tab Visibility Pause
1. Open dashboard with running pipeline
2. Observe regular polling (3s or 60s)
3. Switch to another tab (document.hidden = true)
4. ✅ Expected: Polling completely pauses (no API calls)
5. Return to dashboard tab
6. ✅ Expected: Polling resumes immediately

### Test Case 4: AI Inspector Polling
1. Open AI Inspector panel while pipeline running
2. Verify immediate load (useEffect on mount)
3. Observe subsequent polls every 3 seconds
4. ✅ Expected: Inspector updates match dashboard status changes

### Test Case 5: No Console Errors
1. Run all above tests
2. Check browser console for errors
3. ✅ Expected: Zero errors, only normal logs

## Code Changes Summary

### Files Modified
- `/apps/web/app/page.tsx` (2 polling locations replaced)

### Files Created
- `/apps/web/lib/use-smart-polling.ts` (reusable polling hook)

### No Backend Changes Required ✅
- API endpoints unchanged
- Response format unchanged
- Authentication unchanged

### No New Dependencies ✅
- Uses only React hooks (useEffect, useRef, useCallback)
- No external polling libraries
- No infrastructure changes (SSE/WebSocket)

## Production-Safe Design Decisions

### Why 3 seconds (not lower)?
- Fast enough for users to see pipeline progress
- Reasonable API load (~1200 req/hr during active run)
- Standard polling interval in industry

### Why 60 seconds (not faster)?
- Dashboard already cached and stable in READY state
- Reduces unnecessary API calls by 92%
- Users expecting periodic background refresh, not real-time

### Why pause on document.hidden?
- Massive battery/server load reduction
- User not watching tab anyway
- Resumes immediately when tab returns to focus

### Why not SSE/WebSocket?
- Added complexity before demo
- Requires backend event stream setup
- Connection lifecycle edge cases
- Reverse proxy compatibility risks
- Current polling is sufficient for demo

## Next Steps (Post-Demo)

If realtime updates needed:
1. Implement SSE for `/api/cache-status` stream
2. Implement WebSocket for agent logs
3. Keep polling as fallback for reliability
4. Monitor event backpressure and reconnects

## Rollback Plan

If issues arise:
1. Revert `/apps/web/app/page.tsx` to previous version
2. Delete `/apps/web/lib/use-smart-polling.ts`
3. Old polling behavior restored (fixed 5-second intervals)

---

**Status**: ✅ Ready for Demo
**Risk Level**: ⚠️ Minimal (polling logic only, no architecture changes)
**API Stability Impact**: ✅ None (reduces load, same endpoints)
**User Experience**: ✅ Improved (responsive + battery-friendly)
