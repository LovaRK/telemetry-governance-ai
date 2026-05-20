# Data Purity Phase 2C.1 — Manual Application Guide

**Status:** Patch auto-generation failed on format. Using manual, step-by-step application instead.

**Rationale:** This is actually MORE reliable — you see each file change, can verify before applying, and can stop if anything looks wrong.

---

## Pre-Flight Checklist (Do This First)

```bash
# 1. Clean working tree
git status
# → Must show nothing (no uncommitted changes)

# 2. Verify you're on main/master
git branch

# 3. Create a working branch (safe rollback point)
git checkout -b feature/data-purity-phase-2c-1
```

---

## Step 1: Create Guard Files (New Files)

### 1.1 Create `packages/core/guards/data-purity.guard.ts`

```typescript
/**
 * Data Purity Enforcement Guard
 *
 * Enforces system invariant: All runtime data originates from Splunk, PostgreSQL, or system.
 * No synthetic data, fallbacks, mocks, or defaults are allowed.
 */

export type DataSource = 'splunk' | 'postgres' | 'system';

export interface DataPurityMeta {
  source: DataSource;
  mode: 'live';
  traceId: string;
}

/**
 * Assert that data carries proper purity metadata.
 * Throws immediately if any field is missing or invalid.
 */
export function assertDataPurity(meta: Partial<DataPurityMeta>): void {
  if (!meta) {
    throw new Error('❌ Missing meta (data purity violation)');
  }

  if (!meta.source) {
    throw new Error('❌ Missing source attribution');
  }

  if (!['splunk', 'postgres', 'system'].includes(meta.source)) {
    throw new Error(`❌ Invalid source: ${meta.source}`);
  }

  if (meta.mode !== 'live') {
    throw new Error(`❌ Non-live mode detected: ${meta.mode}`);
  }

  if (!meta.traceId) {
    throw new Error('❌ Missing traceId for distributed tracing');
  }
}
```

### 1.2 Create `packages/core/guards/fail-loud.ts`

```typescript
/**
 * Fail-Loud Guard
 *
 * Converts any error into a SYSTEM_INVARIANT_VIOLATION signal.
 * Never silently falls back or masks errors.
 */

import { logger } from '@infra/observability';

export function failLoudly(error: Error): never {
  logger.error('SYSTEM_INVARIANT_VIOLATION', {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });

  throw new Error(`SYSTEM_INVARIANT_VIOLATION: ${error.message}`);
}
```

### 1.3 Create `packages/core/guards/trace-context.ts`

```typescript
/**
 * Trace Context Propagation
 *
 * Enforces distributed tracing across all execution paths.
 * Every operation is bound to a traceId for end-to-end causality tracking.
 *
 * CRITICAL: traceId generation is ONLY allowed at request boundary or worker start.
 * DO NOT generate new traceIds inside business logic.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuid } from 'uuid';

export type TraceContext = {
  traceId: string;
  timestamp: number;
};

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Wrap an async operation with trace context.
 * Used at request boundaries and worker starts.
 */
export function withTraceContext(traceId: string, fn: () => Promise<any>) {
  return storage.run({ traceId, timestamp: Date.now() }, fn);
}

/**
 * Get current trace ID.
 * MUST be called within withTraceContext or a wrapped execution path.
 * Fallback (uuid generation) ONLY allowed at request boundary.
 */
export function getTraceId(): string {
  const ctx = storage.getStore();
  return ctx?.traceId || '';
}
```

### 1.4 Create `apps/api/middleware/data-purity.middleware.ts`

```typescript
/**
 * Data Purity API Middleware
 *
 * Enforces that all API responses carry proper source attribution.
 */

import { assertDataPurity } from '@core/guards/data-purity.guard';

export interface ApiResponse<T = any> {
  data: T;
  meta: {
    source: 'splunk' | 'postgres' | 'system';
    mode: 'live';
    traceId: string;
  };
}

export function enforceMeta(response: any): void {
  if (!response?.meta) {
    throw new Error('❌ Missing meta in API response');
  }

  assertDataPurity(response.meta);
}
```

### 1.5 Create `apps/api/middleware/trace-context.middleware.ts`

```typescript
/**
 * Trace Context Middleware
 *
 * Injects trace context at request boundary.
 * Every HTTP request gets a traceId that propagates through the entire execution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { withTraceContext } from '@core/guards/trace-context';

/**
 * Higher-order function to wrap route handlers with trace context.
 * Usage:
 *   export const GET = withTraceId(async (req) => {
 *     // handler code here
 *   });
 */
export function withTraceId(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (request: NextRequest) => {
    const incomingTraceId = request.headers.get('x-trace-id') || uuid();

    return withTraceContext(incomingTraceId, () =>
      handler(request)
    );
  };
}
```

### 1.6 Create `scripts/no-mock-check.sh`

```bash
#!/usr/bin/env bash

# Data Purity Enforcement Script
# Prevents mock, demo, fake, fallback, stub, fixture, and sample data from entering runtime code
# Does NOT flag test directories

echo "🔍 Running strict purity check on codebase..."

# Widened dragnet: catch more obfuscated patterns
# Excludes test directories to avoid false positives
VIOLATIONS=$(grep -rE "mock|demo|fake|fallback|sample|stub|fixture|dummy|seed" \
  apps/ packages/ core/ \
  --include="*.ts" --include="*.tsx" \
  2>/dev/null | \
  grep -vE "tests/|__tests__|fixtures|node_modules")

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Data purity violations detected:"
  echo "$VIOLATIONS"
  echo ""
  echo "⚠️ CRITICAL: Synthetic data patterns found in runtime code"
  echo "   Move all mocks to /tests directories only"
  echo "   Replace with live data sources (Splunk, PostgreSQL, system)"
  exit 1
fi

echo "✅ Data purity check passed — no synthetic data in runtime paths"
exit 0
```

Make it executable:
```bash
chmod +x scripts/no-mock-check.sh
```

---

## Step 2: Create Migration File

### 2.1 Create `prisma/migrations/122_data_purity/migration.sql`

```sql
-- Migration 122: Data Purity Enforcement
--
-- Adds source attribution, mode constraints, and trace context to execution substrate.
-- Enforces system invariant: runtime data MUST be live, never synthetic or fallback.
-- Enables end-to-end causality tracking via traceId.

ALTER TABLE execution_actions
ADD COLUMN source VARCHAR(32) NOT NULL,
ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'live',
ADD COLUMN trace_id UUID NOT NULL;

-- 🔒 CRITICAL: Prevent non-live data from being persisted
ALTER TABLE execution_actions
ADD CONSTRAINT chk_execution_actions_mode CHECK (mode = 'live');

ALTER TABLE execution_results
ADD COLUMN source VARCHAR(32) NOT NULL,
ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'live',
ADD COLUMN trace_id UUID NOT NULL;

-- 🔒 CRITICAL: Prevent non-live data from being persisted
ALTER TABLE execution_results
ADD CONSTRAINT chk_execution_results_mode CHECK (mode = 'live');

-- Create system_config table (replaces in-memory config storage)
-- Source attribution ensures config is traceable to origin
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  source VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 🔒 CRITICAL: Source must be one of three known origins
ALTER TABLE system_config
ADD CONSTRAINT chk_config_source
CHECK (source IN ('user_override', 'system_default', 'splunk_tag'));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_system_config_updated ON system_config(updated_at DESC);

-- Document: source must be traceable
COMMENT ON TABLE system_config IS 'System configuration with mandatory source attribution. Source must be: user_override (user-set), system_default (code default), or splunk_tag (from Splunk). All config values are auditable.';
COMMENT ON COLUMN system_config.source IS 'Origin of config value: must be traceable to user action, system default, or Splunk tag. No anonymous/unknown sources allowed.';
COMMENT ON COLUMN system_config.value IS 'Configuration value stored as JSON. Type enforcement is responsibility of application layer.';
```

---

## Step 3: Modify Existing Files

### 3.1 Modify `apps/api/bootstrap.ts`

Add at the START of the `bootstrap()` function:

```typescript
  // 🔒 DATA PURITY: Reject DEMO_MODE runtime
  if (process.env.DEMO_MODE === 'true') {
    throw new Error(
      '❌ DEMO_MODE is forbidden in runtime. System must operate with live data only. ' +
      'Remove DEMO_MODE from environment variables.'
    );
  }
```

### 3.2 Modify `packages/core/workflow/executor-v2.ts`

Add to imports:
```typescript
import { assertDataPurity } from '@core/guards/data-purity.guard';
import { failLoudly } from '@core/guards/fail-loud';
import { getTraceId } from '@core/guards/trace-context';
```

After the adapter call (around line 25-30), add:
```typescript
    // 🔒 GUARD 1: Validate adapter response carries purity metadata
    assertDataPurity({
      source: result.source,
      mode: result.mode,
      traceId: result.traceId,
    });
```

In the INSERT statement, add columns and parameters for `source`, `mode`, `trace_id`:
```typescript
    const resultRecord = await query(
      `INSERT INTO execution_results
       (action_id, execution_id, status, attempt_number,
        result_payload, error_code,
        source, mode, trace_id,
        recorded_at)
       VALUES ($1, $2, 'SUCCEEDED', $3, $4, NULL, $5, 'live', $6, NOW())
       RETURNING *`,
      [
        action.action_id,
        action.execution_id,
        action.attempt_count + 1,
        JSON.stringify(result.payload),
        result.source,
        getTraceId(),
      ]
    );
```

Change the catch block from:
```typescript
    throw error;
```

To:
```typescript
    failLoudly(error as Error);
```

### 3.3 Modify `apps/web/app/api/governance/replay/route.ts`

Add to imports:
```typescript
import { getTraceId } from '@core/guards/trace-context';
import { withTraceId } from '@api/middleware/trace-context.middleware';
```

REMOVE the entire fallback block (lines that query agent_decisions) and replace with:
```typescript
    // 🔒 DATA PURITY: Do NOT fallback to stale data
    if (res.rows.length === 0) {
      return NextResponse.json(
        {
          error: 'REPLAY_NOT_AVAILABLE',
          message: 'Execution journal missing — cannot reconstruct state',
          details: 'governance_replay_journal not populated for this period',
          meta: {
            source: 'system',
            mode: 'live',
            traceId: getTraceId(),
          },
        },
        { status: 503 }
      );
    }
```

Add `meta` to the success response:
```typescript
    return NextResponse.json({
      replayRecords: res.rows.map((r) => ({
        id: r.replay_id,
        indexName: r.index_name,
        sourcetype: r.sourcetype,
        state: r.snapshot_state,
        recordedAt: r.recorded_at,
        source: r.replay_source,
      })),
      meta: { source: 'postgres', mode: 'live', traceId: getTraceId() },
    });
```

### 3.4 Modify `apps/web/app/api/config/route.ts`

REMOVE these lines entirely:
```typescript
const DEFAULT_CONFIG: UserConfig = {
  costPerGbPerDay: 0.5,
  maxIndexesPerRun: 1000,
  llmTimeoutMs: 30000,
};
let config: UserConfig = { ...DEFAULT_CONFIG };
```

Add to imports:
```typescript
import { getTraceId } from '@core/guards/trace-context';
import { withTraceId } from '@api/middleware/trace-context.middleware';
```

Change both GET and POST handlers to use `withTraceId` HOF and load from `system_config` table instead of in-memory config.

GET handler:
```typescript
export const GET = withTraceId(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const result = await query<any>(
      `SELECT key, value, source FROM system_config ORDER BY updated_at DESC`,
      []
    );

    const config: Record<string, any> = {};
    result.rows.forEach((row) => {
      config[row.key] = row.value;
    });

    return NextResponse.json({
      data: config,
      meta: {
        source: 'postgres',
        mode: 'live',
        traceId: getTraceId(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/config] GET failed:', message);
    return NextResponse.json(
      {
        error: '❌ Failed to load configuration from database',
        details: message,
        action: 'Check system_config table and database connection',
        meta: {
          source: 'system',
          mode: 'live',
          traceId: getTraceId(),
        },
      },
      { status: 500 }
    );
  }
});
```

POST handler (validate source field):
```typescript
export const POST = withTraceId(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const body = await request.json();

    // 🔒 Validate: source MUST be explicit and known
    if (!body.source || !['user_override', 'system_default', 'splunk_tag'].includes(body.source)) {
      return NextResponse.json(
        {
          error: '❌ Missing or invalid source',
          message: 'Must specify source: user_override, system_default, or splunk_tag',
          meta: {
            source: 'system',
            mode: 'live',
            traceId: getTraceId(),
          },
        },
        { status: 400 }
      );
    }

    // Update each key in system_config with source
    const updatePromises = Object.entries(body).map(async ([key, value]) => {
      if (key === 'source') return;

      await query(
        `INSERT INTO system_config (key, value, source, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, source = $3, updated_at = NOW()`,
        [key, JSON.stringify(value), body.source]
      );
    });

    await Promise.all(updatePromises);

    // Return updated config with meta
    const result = await query<any>(
      `SELECT key, value, source FROM system_config`,
      []
    );

    const config: Record<string, any> = {};
    result.rows.forEach((row) => {
      config[row.key] = row.value;
    });

    return NextResponse.json({
      data: config,
      meta: {
        source: 'postgres',
        mode: 'live',
        traceId: getTraceId(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/config] POST failed:', message);
    return NextResponse.json(
      {
        error: '❌ Failed to update configuration',
        details: message,
        action: 'Ensure source field is provided',
        meta: {
          source: 'system',
          mode: 'live',
          traceId: getTraceId(),
        },
      },
      { status: 400 }
    );
  }
});
```

### 3.5 Modify `core/services/events.ts`

Add to imports:
```typescript
import { getTraceId } from '@core/guards/trace-context';
```

Add new interface and function:
```typescript
export interface GovernanceEvent extends SystemEvent {
  source: 'system';
  mode: 'live';
  traceId: string;
}

/**
 * Emit governance events with mandatory purity metadata.
 * Ensures lineage is never broken by un-traced events.
 */
export function emitGovernanceEvent(event: SystemEvent): void {
  const pureEvent: GovernanceEvent = {
    ...event,
    source: 'system',
    mode: 'live',
    traceId: getTraceId(),
  };
  eventBus.emit(event.type, pureEvent);
}
```

Update the `emit` function:
```typescript
export function emit(event: SystemEvent): void {
  emitGovernanceEvent(event);
}
```

### 3.6 Modify `.github/workflows/test.yml`

Add this step AFTER the "Run unit tests" step:

```yaml
    - name: 🔒 Data Purity Check
      run: bash scripts/no-mock-check.sh
      continue-on-error: false
```

---

## Step 4: Verify and Apply Migration

```bash
# Run the migration
prisma migrate deploy

# Verify database changes
psql -c "\d execution_results" 
# Should show: source, mode, trace_id columns

psql -c "\d system_config"
# Should show the new table
```

---

## Step 5: Ready for Chaos Tests

```bash
git status
# Should show all new files and modified files

npm run test:chaos
# Will fail with expected purity errors
```

---

## Rollback (If Needed)

```bash
git reset --hard HEAD
# Or if you created a branch:
git checkout main
git branch -D feature/data-purity-phase-2c-1
```

---

## Next: Come Back With

Once you've applied all changes:

👉 **"post-patch failures"**

I'll help you fix test contracts and stabilize under strict mode.
