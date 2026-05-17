# Critical Fixes Sprint Plan
## 🔴 One-Week Implementation (Priority Order)

**Branch:** `claude/critical-stability-sprint`  
**Start:** 2026-05-16  
**Goal:** Model stability + config-driven controls + cold start UX

---

## Day 1-2: Model Stability & Config Lock

### Task: Switch to gemma2:9b (Stable Primary)

**Files to change:**
- `apps/api/agents/telemetry-decision-agent.ts`
  - Change: hardcoded `"gemma4:e4b"` → `process.env.LLM_MODEL`
  - Add: validation at startup (fail if LLM_MODEL not set)
  - Add: fallback model check (if primary unavailable, try fallback)

- `.env.example` (add)
  ```
  LLM_MODEL=gemma2:9b
  FALLBACK_MODE=AUTO
  TOTAL_PIPELINE_TIMEOUT=120000
  SPLUNK_QUERY_TIMEOUT=30000
  LLM_BATCH_TIMEOUT=30000
  MAX_PARALLEL_INDEXES=2
  LOOKBACK_WINDOW_DAYS=7
  BATCH_SIZE=5
  ```

- `docker/docker-compose.yml` (update Ollama service)
  ```yaml
  ollama:
    environment:
      - OLLAMA_MODELS=/root/.ollama/models
    # Pre-pull gemma2:9b on startup
    command: sh -c "ollama pull gemma2:9b && ollama serve"
  ```

- `scripts/bootstrap.sh` (add validation)
  ```bash
  # Fail if LLM_MODEL not set
  if [ -z "$LLM_MODEL" ]; then
    echo "❌ ERROR: LLM_MODEL not set"
    exit 1
  fi
  
  # Validate model is available
  docker exec ollama ollama list | grep -q "$LLM_MODEL" || {
    echo "Pulling $LLM_MODEL..."
    docker exec ollama ollama pull "$LLM_MODEL"
  }
  ```

**Tests to add:**
- Verify LLM_MODEL=gemma2:9b passes startup check
- Verify LLM_MODEL unset fails startup with clear error
- Verify switching LLM_MODEL between runs doesn't happen (env locked)

---

## Day 2-3: Config-Driven Timeout Controls

### Task: Implement TOTAL_PIPELINE_TIMEOUT + SPLUNK_QUERY_TIMEOUT

**Files to change:**
- `apps/api/services/aggregation-service.ts`
  ```typescript
  const TOTAL_TIMEOUT = parseInt(process.env.TOTAL_PIPELINE_TIMEOUT || '120000');
  const startTime = Date.now();
  const deadline = startTime + TOTAL_TIMEOUT;
  
  // At each stage
  if (Date.now() > deadline) {
    logger.warn('Pipeline timeout exceeded, using cached snapshot');
    return cachedSnapshot;
  }
  
  // Splunk fetch
  const SPLUNK_TIMEOUT = parseInt(process.env.SPLUNK_QUERY_TIMEOUT || '30000');
  try {
    return await fetchWithTimeout(splunkUrl, SPLUNK_TIMEOUT);
  } catch (err) {
    // Retry 2x with exponential backoff
  }
  ```

- `apps/api/agents/telemetry-decision-agent.ts`
  ```typescript
  const BATCH_TIMEOUT = parseInt(process.env.LLM_BATCH_TIMEOUT || '30000');
  const MAX_RETRIES = 2;
  
  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    try {
      return await ollamaRequest(batch, BATCH_TIMEOUT);
    } catch (err) {
      if (retry < MAX_RETRIES) {
        logger.info(`Batch timeout, retry ${retry + 1}/${MAX_RETRIES}`);
        continue;
      } else {
        logger.error('Batch failed after retries, trying Anthropic fallback');
        return await anthropicFallback(batch);
      }
    }
  }
  ```

**Tests:**
- Set TOTAL_PIPELINE_TIMEOUT=5000, verify timeout at <5s
- Verify Splunk retry loop (2x)
- Verify LLM batch retry logic (2x before fallback)

---

## Day 3-4: LLM Prompt Purity (Remove Implicit Rules)

### Task: Pure Agentic Prompt (No Scoring Hints)

**File to change:**
- `apps/api/agents/telemetry-decision-agent.ts` → `buildDecisionPrompt()`

**Remove from prompt:**
- ❌ `"Score utilization 0-100 based on..."`
- ❌ `"If utilization + detection > 150, assign CRITICAL"`
- ❌ Pre-computed scores
- ❌ Decision thresholds
- ❌ Any "if X then Y" rules

**New prompt:**
```
You are a Splunk index advisor. Based on the signals below, 
recommend a TIER and ACTION for each index.

Signals provided:
- daily_gb, total_events, retention_days, last_event_date
- sourcetype_category, is_scheduled_search, is_alert
- annual_cost_usd (derived)

For each index:
1. TIER: CRITICAL | IMPORTANT | NICE_TO_HAVE | LOW_VALUE
2. ACTION: KEEP | OPTIMIZE | ARCHIVE | ELIMINATE | S3_CANDIDATE
3. CONFIDENCE: 0-1
4. REASONING: 1-2 sentences
5. EVIDENCE: 3-5 specific signals

Do NOT reference scoring frameworks or rules. Decide based purely on signals.
```

**Tests:**
- Parse LLM output, ensure no "score" fields expected
- Verify confidence and evidence always present
- Verify no implicit tier/action logic in code (all from LLM)

---

## Day 4-5: Cold Start UX + Connection Gating

### Task: Splunk Connection Banner & Settings Page

**Files to create:**
- `apps/web/components/shared/ConnectionGatedUI.tsx` (new)
  ```typescript
  export function ConnectionGatedUI() {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔌</div>
        <h2>Connect Splunk to Get Started</h2>
        <p>Dashboard needs Splunk credentials to fetch index metrics</p>
        <button onClick={() => window.location.href = '/settings'}>
          Go to Settings
        </button>
      </div>
    );
  }
  ```

- `apps/web/app/settings/page.tsx` (new)
  ```typescript
  export default function SettingsPage() {
    const [host, setHost] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    
    async function testConnection() {
      setTesting(true);
      const res = await fetch('/api/test-splunk-connection', {
        method: 'POST',
        body: JSON.stringify({ host, username, password })
      });
      const data = await res.json();
      setTestResult(data);
      setTesting(false);
    }
    
    async function save() {
      // Save to env/store
      // Redirect to dashboard
    }
    
    return (
      // Form with inputs + Test button + Save button
    );
  }
  ```

**Files to change:**
- `apps/web/app/page.tsx`
  ```typescript
  useEffect(() => {
    fetch('/api/cache-status')
      .then(r => r.json())
      .then(data => {
        if (!data.splunk_configured) {
          setShowGating(true);
        }
      });
  }, []);
  
  if (showGating) return <ConnectionGatedUI />;
  return <Dashboard />;
  ```

- `apps/web/app/api/cache-status/route.ts`
  ```typescript
  return NextResponse.json({
    splunk_configured: !!process.env.SPLUNK_HOST && !!process.env.SPLUNK_USERNAME,
    // ... rest of fields
  });
  ```

- `apps/web/app/api/test-splunk-connection/route.ts` (new)
  ```typescript
  export async function POST(request: NextRequest) {
    const { host, username, password } = await request.json();
    try {
      const res = await fetch(`https://${host}:8089/services/appserver/info`, {
        headers: {
          'Authorization': `Basic ${btoa(username + ':' + password)}`
        }
      });
      if (res.ok) return NextResponse.json({ success: true });
      return NextResponse.json({ success: false, message: `HTTP ${res.status}` });
    } catch (err) {
      return NextResponse.json({ success: false, message: err.message });
    }
  }
  ```

**Tests:**
- Unconfigured Splunk → show gating banner
- Configured Splunk → show dashboard
- Test connection succeeds → enable Save button
- Save settings → redirect to dashboard

---

## Day 5: System Observability + Metrics Table

### Task: Add system_metrics Table & Instrumentation

**Files to change:**
- `infrastructure/migrations/008_system_metrics.sql` (new)
  ```sql
  CREATE TABLE system_metrics (
    id SERIAL PRIMARY KEY,
    metric_type VARCHAR(50) NOT NULL,
    metric_value DECIMAL(10,2) NOT NULL,
    metric_unit VARCHAR(20) NOT NULL,
    snapshot_id INTEGER,
    batch_number INTEGER,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_metric_type (metric_type),
    INDEX idx_created_at (created_at)
  );
  ```

- `apps/api/services/aggregation-service.ts`
  ```typescript
  const metrics = new MetricsCollector();
  
  const t1 = Date.now();
  const splunkData = await fetchTelemetry();
  await metrics.recordMetric('splunk_fetch_ms', Date.now() - t1, 'ms', {
    index_count: splunkData.length
  });
  
  // Similar for each stage
  ```

- `apps/api/lib/metrics.ts` (new)
  ```typescript
  export class MetricsCollector {
    async recordMetric(type: string, value: number, unit: string, context?: any) {
      if (process.env.METRICS_ENABLED !== 'true') return;
      
      const client = await getConnectionPool();
      try {
        await client.query(
          'INSERT INTO system_metrics (metric_type, metric_value, metric_unit, context, created_at) VALUES ($1, $2, $3, $4, NOW())',
          [type, value, unit, JSON.stringify(context || {})]
        );
      } finally {
        client.release();
      }
    }
  }
  ```

**Tests:**
- Enable METRICS_ENABLED=true
- Run aggregation, verify metrics inserted
- Query system_metrics table, verify timing data

---

## Day 5+ (Optional): PDF Alignment & UI Drill-Down

### Task: Unified Drill-Down on All Interactive Elements

**Scope (High Priority):**
- KPI gauge values → ReasoningDrawer (formula + context)
- Savings staircase bars → ReasoningDrawer (which indexes)
- Quick wins rows → Already done (verify consistency)
- Scatter plot bubbles → ReasoningDrawer (index details)

**Low Priority (v4 Detail Page):**
- Grouping sections (Security/Quality/Cost/Ops)
- Decision trace visualization
- Every table row drill-down

---

## Testing Checklist

- [ ] LLM_MODEL=gemma2:9b startup validation passes
- [ ] LLM_MODEL switching blocked (no runtime changes)
- [ ] TOTAL_PIPELINE_TIMEOUT enforced (aborts at deadline)
- [ ] SPLUNK_QUERY_TIMEOUT + 2x retry works
- [ ] LLM_BATCH_TIMEOUT + 2x retry works
- [ ] Fallback to Anthropic on Ollama timeout
- [ ] Prompt has zero implicit rules
- [ ] Cold start gating works (shows banner if unconfigured)
- [ ] Settings page connects and saves Splunk config
- [ ] system_metrics table receives timing data
- [ ] KPI gauges have drill-down (Reasoning Drawer)
- [ ] All config env vars have defaults

---

## Commits

1. `feat: Switch LLM primary to gemma2:9b, lock model via config`
2. `feat: Add global pipeline timeout + config-driven controls`
3. `feat: Remove implicit rules from LLM prompt (pure agentic)`
4. `feat: Cold start UX with Splunk connection gating`
5. `feat: System observability (system_metrics table + instrumentation)`
6. `refactor: Unified drill-down UI (KPI gauges, savings, bubbles)`

---

**Estimated Effort:** 40 hours  
**Risk Level:** 🟡 Medium (model stability impact is high, but gemma2:9b is proven stable)  
**Success Criteria:** Model never crashes, timeouts enforced, config controls work, cold start UX clear

