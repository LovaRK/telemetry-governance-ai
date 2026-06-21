/**
 * Tenant Config Service
 *
 * DB-backed replacement for the in-memory `runtime-config.ts`.
 * Persists all runtime configuration to the `tenant_config` table.
 *
 * CRITICAL: This eliminates the "Changes are not persisted (in-memory only for demo)"
 * comment in apps/web/app/api/config/route.ts.
 *
 * Architecture:
 * - Write-through cache: reads from in-memory cache, falls back to DB, writes back to cache
 * - Cache TTL: 60 seconds (config changes are rare but should propagate quickly)
 * - Thread-safe: uses simple object mutation (Node.js is single-threaded)
 * - Fail-open: if DB is unavailable, returns defaults (logs error)
 */

import { Pool } from 'pg';

export interface TenantRuntimeConfig {
  costPerGbPerDay: number;
  maxIndexesPerRun: number;
  llmTimeoutMs: number;
  llmProvider?: 'local' | 'anthropic';
  decisionWeights?: Record<string, unknown>;
}

const DEFAULT_CONFIG: TenantRuntimeConfig = {
  costPerGbPerDay: 0.5,
  maxIndexesPerRun: 1000,
  llmTimeoutMs: 30000,
};

const SYSTEM_TENANT = 'SYSTEM';

// ─────────────────────────────────────────────
// Cache (write-through, 60s TTL)
// ─────────────────────────────────────────────

interface CacheEntry {
  config: TenantRuntimeConfig;
  loadedAt: number;
}

const configCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.loadedAt < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────
// DB Helpers
// ─────────────────────────────────────────────

async function readConfigFromDB(
  pool: Pool,
  tenantId: string
): Promise<Partial<TenantRuntimeConfig>> {
  const result = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM tenant_config WHERE tenant_id = $1`,
    [tenantId]
  );

  const config: Partial<TenantRuntimeConfig> = {};
  for (const row of result.rows) {
    const val = row.value;
    switch (row.key) {
      case 'costPerGbPerDay':
        config.costPerGbPerDay = typeof val === 'number' ? val : Number(val);
        break;
      case 'maxIndexesPerRun':
        config.maxIndexesPerRun = typeof val === 'number' ? val : Number(val);
        break;
      case 'llmTimeoutMs':
        config.llmTimeoutMs = typeof val === 'number' ? val : Number(val);
        break;
      case 'llmProvider':
        config.llmProvider = String(val) as 'local' | 'anthropic';
        break;
      case 'decisionWeights':
        config.decisionWeights = val as Record<string, unknown>;
        break;
    }
  }
  return config;
}

async function writeConfigKeyToDB(
  pool: Pool,
  tenantId: string,
  key: string,
  value: unknown,
  updatedBy?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO tenant_config (tenant_id, key, value, updated_at, updated_by)
     VALUES ($1, $2, $3::jsonb, NOW(), $4)
     ON CONFLICT (tenant_id, key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
    [tenantId, key, JSON.stringify(value), updatedBy ?? null]
  );
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Get runtime config for a tenant.
 * Falls back to SYSTEM defaults if tenant has no overrides.
 * Falls back to hardcoded defaults if DB is unavailable.
 */
export async function getTenantConfig(
  pool: Pool,
  tenantId: string = SYSTEM_TENANT
): Promise<TenantRuntimeConfig> {
  // Check cache first
  const cached = configCache.get(tenantId);
  if (cached && isCacheValid(cached)) {
    return cached.config;
  }

  try {
    // Load tenant-specific config
    const tenantOverrides = await readConfigFromDB(pool, tenantId);

    // Load SYSTEM defaults (as fallback layer)
    let systemDefaults: Partial<TenantRuntimeConfig> = {};
    if (tenantId !== SYSTEM_TENANT) {
      systemDefaults = await readConfigFromDB(pool, SYSTEM_TENANT);
    }

    // Merge: hardcoded defaults → SYSTEM DB → tenant overrides
    const config: TenantRuntimeConfig = {
      ...DEFAULT_CONFIG,
      ...systemDefaults,
      ...tenantOverrides,
    };

    // Write-through cache
    configCache.set(tenantId, { config, loadedAt: Date.now() });

    return config;
  } catch (error) {
    console.error('[TENANT_CONFIG_LOAD_FAILED]', {
      tenant_id: tenantId,
      error: error instanceof Error ? error.message : String(error),
      fallback: 'using hardcoded defaults',
      timestamp: new Date().toISOString()
    });

    // Fail-open: return defaults rather than crashing the application
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Update runtime config for a tenant.
 * Persists to DB and invalidates cache.
 */
export async function updateTenantConfig(
  pool: Pool,
  patch: Partial<TenantRuntimeConfig>,
  tenantId: string = SYSTEM_TENANT,
  updatedBy?: string
): Promise<TenantRuntimeConfig> {
  const writes: Promise<void>[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      writes.push(writeConfigKeyToDB(pool, tenantId, key, value, updatedBy));
    }
  }

  await Promise.all(writes);

  // Invalidate cache
  configCache.delete(tenantId);

  console.log('[TENANT_CONFIG_UPDATED]', {
    tenant_id: tenantId,
    keys_updated: Object.keys(patch),
    updated_by: updatedBy,
    timestamp: new Date().toISOString()
  });

  // Return fresh config
  return getTenantConfig(pool, tenantId);
}

/**
 * Invalidate the in-memory cache for a tenant.
 * Call after external config changes.
 */
export function invalidateTenantConfigCache(tenantId: string = SYSTEM_TENANT): void {
  configCache.delete(tenantId);
}

/**
 * Get the raw cache entry (for diagnostics/health endpoints).
 */
export function getTenantConfigCacheStatus(tenantId: string = SYSTEM_TENANT): {
  cached: boolean;
  age_ms?: number;
  ttl_remaining_ms?: number;
} {
  const entry = configCache.get(tenantId);
  if (!entry) return { cached: false };

  const age_ms = Date.now() - entry.loadedAt;
  return {
    cached: true,
    age_ms,
    ttl_remaining_ms: Math.max(0, CACHE_TTL_MS - age_ms)
  };
}
