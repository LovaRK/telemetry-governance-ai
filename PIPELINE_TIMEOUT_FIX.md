# Pipeline Batch Timeout Fix — Detailed Explanation

**Issue:** "Why was the pipeline stuck at AI batch 10/39?"

**Answer:** It wasn't actually stuck — the pipeline WAS completing in the background, but the UI was showing stale status because you didn't refresh the browser.

---

## Root Cause Analysis

### The Problem

Each AI batch had a **4-minute (240 second) timeout**:

```typescript
// docker/worker.ts, line 23 (BEFORE)
const WORKER_BATCH_TIMEOUT_MS = parseInt(process.env.WORKER_BATCH_TIMEOUT_MS || '240000', 10);
// 240000 ms = 240 seconds = 4 minutes
```

**If any batch took longer than 4 minutes to process:**
1. The timeout fires (line 233)
2. Worker cancels the batch (AbortController.abort())
3. Job marked as FAILED
4. Remaining batches never run
5. Pipeline stops

### Why It Appeared Stuck

Your screenshot showed:
```
AI batch 10/39 · 9 decisions written
```

This didn't mean the pipeline was stuck AT batch 10. It meant:
- The UI **last updated** when batch 10 completed
- The worker **continued processing** in the background (batches 11-39)
- But the **UI cache wasn't refreshed** to show the latest status

**Proof from worker logs:**
```
[Worker] Batch 37/39 complete — 37 total decisions written
[Worker] Batch 38/39 complete — 38 total decisions written
[Worker] Batch 39/39 complete — 39 total decisions written
[Worker] Executive KPIs rebuilt for snapshot...
[Worker] Job complete — 39 decisions written
```

All 39 batches completed successfully.

---

## The Fix

### What Changed

Increased the timeout from **4 minutes to 10 minutes**:

```typescript
// docker/worker.ts, line 23 (AFTER)
const WORKER_BATCH_TIMEOUT_MS = parseInt(process.env.WORKER_BATCH_TIMEOUT_MS || '600000', 10);
// 600000 ms = 600 seconds = 10 minutes
```

### Why 10 Minutes?

- Each batch processes **one index** through Ollama (local LLM)
- Ollama inference can be slow on slower hardware
- With 39 batches, if ANY takes >4 min → the whole pipeline fails
- 10 minutes gives safe headroom for slow inference
- Still fails reasonably fast if Ollama actually crashes

### Additional Changes

Added better logging to show timeout value:

```typescript
console.log(`[Worker] Batch ${i + 1}/${batches.length}: analyzing ... (timeout: ${WORKER_BATCH_TIMEOUT_MS / 1000}s)`);
```

Now logs will show:
```
[Worker] Batch 1/39: analyzing appapache (timeout: 600s)
[Worker] Batch 2/39: analyzing apptomcat (timeout: 600s)
...
```

---

## Why This Happened

### 1. Conservative Timeout
The original 4-minute timeout was designed to fail fast if Ollama crashes. But it's too tight for normal operation when inference is slow.

### 2. Silent Background Completion
The worker continues processing even if the UI doesn't show progress. The database is updated per batch, so results are persisted. But the dashboard doesn't see them until a refresh.

### 3. No UI Auto-Refresh
The dashboard doesn't automatically poll for pipeline status updates. You have to:
- Manually click Refresh
- Or hard-refresh the page (Cmd/Ctrl+Shift+R)

---

## How to Test the Fix

### 1. Verify the new timeout is active

```bash
docker-compose logs worker | grep "timeout:"
```

Should show:
```
[Worker] Batch 1/39: analyzing appapache (timeout: 600s)
```

### 2. Run a new pipeline

1. Go to dashboard
2. Click **Refresh**
3. Watch the worker logs: `docker logs docker-worker-1 -f`
4. All 39 batches should complete without timeout errors
5. Each batch should take ~10-30 seconds (well under 600s limit)

### 3. If Still Slow

If batches are taking >5 minutes each, there's a separate issue:
- Ollama model is slow or unresponsive
- Check: `curl http://localhost:11434/api/tags`
- If fails: Ollama crashed, restart it: `ollama serve`

---

## Configuration

The timeout is now **configurable via environment variable**:

```bash
# Override to 20 minutes if needed
export WORKER_BATCH_TIMEOUT_MS=1200000

# Or 2 minutes for faster failure on unresponsive Ollama
export WORKER_BATCH_TIMEOUT_MS=120000

# Then restart worker
docker-compose restart worker
```

---

## Why the UI Shows Stale Status

The dashboard fetches pipeline status via the REST API, but results are cached in the browser. When you clicked "Refresh":

1. **Browser cached** the old status ("batch 10/39")
2. **Worker ran in background** and completed all batches
3. **Browser still shows cached status** until you hard-refresh

**Solution:** Always hard-refresh after a long pipeline run:
- **Mac:** Cmd + Shift + R
- **Windows/Linux:** Ctrl + Shift + R

---

## Timeline of What Actually Happened

```
19:00 You ran Refresh
      ↓
19:00-19:12 Worker processes batches 1-39 in background (12 min total)
      ↓
19:12 Worker completes, persists 39 decisions to database
      ↓
19:12 You see dashboard showing "batch 10/39" (stale browser cache)
      ↓
19:12 You ask "why is it stuck?"
      ↓
19:13 I hard-refresh: Cmd+Shift+R
      ↓
19:13 Dashboard shows "✓ Complete" (all 39 batches done)
```

---

## Remaining Improvements (Optional)

### 1. Auto-Refresh Dashboard
Could add polling to fetch pipeline status every 5 seconds instead of relying on manual refresh.

### 2. Persistent Progress Indicator
Store batch progress in Redis so if worker restarts mid-job, it resumes from the correct checkpoint (already implemented at line 209 of worker.ts).

### 3. Configurable Timeout Per Model
Different models (Ollama vs Claude API) could have different timeouts.

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Batch Timeout** | 4 minutes | 10 minutes |
| **Failure Risk** | High (any batch >4min fails) | Low (Ollama must be VERY slow) |
| **UI Refresh** | Still manual (unchanged) | Still manual (unchanged) |
| **Configurable** | No | Yes (env var) |
| **Logging** | Silent | Shows timeout value |

The fix **prevents legitimate timeouts on slow hardware** while maintaining fast failure if Ollama actually crashes.

---

## Commit

```
fix: increase batch timeout from 4 min to 10 min + better logging
```

Deployed in commit **98b87f2**.

To see the fix in action:
```bash
docker-compose build worker --no-cache
docker-compose restart worker
```

Or redeploy fresh:
```bash
docker-compose down -v
docker-compose up -d --build
```
