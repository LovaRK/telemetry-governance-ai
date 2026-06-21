/**
 * GET/POST /api/config
 *
 * Runtime configuration endpoint.
 * Config that has a DB column is persisted to user_config.
 * Fields without a DB column (maxIndexesPerRun, llmTimeoutMs) remain defaults.
 *
 * Config hierarchy:
 * 1. Hardcoded defaults (lowest priority)
 * 2. user_config row (config_key='default') — persisted fields
 */

import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export interface TenantRuntimeConfig {
  costPerGbPerDay: number;
  maxIndexesPerRun: number;
  llmTimeoutMs: number;
  llmProvider?: 'local' | 'anthropic';
  decisionWeights?: Record<string, unknown>;
}

const DEFAULTS: TenantRuntimeConfig = {
  costPerGbPerDay: 10.0,   // $3,650/GB/year ÷ 365 — Splunk Enterprise legacy rate
  maxIndexesPerRun: 1000,
  llmTimeoutMs: 30000,
};

// ─────────────────────────────────────────────
// DB helpers — reads/writes user_config (columnar, config_key='default')
// ─────────────────────────────────────────────

async function loadConfigFromDB(): Promise<Partial<TenantRuntimeConfig>> {
  const result = await query<{
    cost_per_gb_per_day: string;
    llm_provider: string | null;
    decision_weights: Record<string, unknown> | null;
  }>(
    `SELECT cost_per_gb_per_day, llm_provider, decision_weights
     FROM user_config WHERE config_key = 'default' LIMIT 1`
  );
  if (result.rows.length === 0) return {};
  const row = result.rows[0];
  const config: Partial<TenantRuntimeConfig> = {};
  if (row.cost_per_gb_per_day != null) config.costPerGbPerDay = Number(row.cost_per_gb_per_day);
  if (row.llm_provider) config.llmProvider = row.llm_provider as 'local' | 'anthropic';
  if (row.decision_weights) config.decisionWeights = row.decision_weights;
  return config;
}

async function saveConfigToDB(patch: Partial<TenantRuntimeConfig>): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.costPerGbPerDay !== undefined) {
    setClauses.push(`cost_per_gb_per_day = $${idx++}`);
    values.push(patch.costPerGbPerDay);
  }
  if (patch.llmProvider !== undefined) {
    setClauses.push(`llm_provider = $${idx++}`);
    values.push(patch.llmProvider);
  }
  if (patch.decisionWeights !== undefined) {
    setClauses.push(`decision_weights = $${idx++}::jsonb`);
    values.push(JSON.stringify(patch.decisionWeights));
  }

  if (setClauses.length === 0) return;

  await query(
    `UPDATE user_config SET ${setClauses.join(', ')}, updated_at = NOW() WHERE config_key = 'default'`,
    values
  );
}

// ─────────────────────────────────────────────
// GET /api/config
// ─────────────────────────────────────────────

export const GET = createRoute(async (_request: NextRequest) => {
  let dbConfig: Partial<TenantRuntimeConfig> = {};
  let source: 'postgres' | 'system' = 'postgres';

  try {
    dbConfig = await loadConfigFromDB();
  } catch (error) {
    console.error('[CONFIG_LOAD_FAILED]', {
      error: error instanceof Error ? error.message : String(error),
      fallback: 'defaults',
      timestamp: new Date().toISOString()
    });
    source = 'system';
  }

  const config: TenantRuntimeConfig = { ...DEFAULTS, ...dbConfig };

  return {
    data: config,
    meta: { source, persisted: source === 'postgres' },
  };
});

// ─────────────────────────────────────────────
// POST /api/config
// ─────────────────────────────────────────────

export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const patch: Partial<TenantRuntimeConfig> = {};

  if (body.costPerGbPerDay !== undefined) {
    const cost = Number(body.costPerGbPerDay);
    if (!Number.isFinite(cost) || cost < 0.01 || cost > 1000) {
      // $0.01–$1,000/GB/day = $3.65–$365,000/GB/year — covers all known Splunk contracts
      throw new Error('costPerGbPerDay must be between 0.01 and 1000');
    }
    patch.costPerGbPerDay = cost;
  }

  if (body.maxIndexesPerRun !== undefined) {
    if (typeof body.maxIndexesPerRun !== 'number' || body.maxIndexesPerRun <= 0) {
      throw new Error('maxIndexesPerRun must be a positive number');
    }
    patch.maxIndexesPerRun = body.maxIndexesPerRun;
  }

  if (body.llmTimeoutMs !== undefined) {
    if (typeof body.llmTimeoutMs !== 'number' || body.llmTimeoutMs <= 0) {
      throw new Error('llmTimeoutMs must be a positive number');
    }
    patch.llmTimeoutMs = body.llmTimeoutMs;
  }

  if (body.llmProvider !== undefined) {
    if (!['local', 'anthropic'].includes(body.llmProvider)) {
      throw new Error('llmProvider must be "local" or "anthropic"');
    }
    patch.llmProvider = body.llmProvider;
  }

  if (body.decisionWeights !== undefined) {
    if (!body.decisionWeights || typeof body.decisionWeights !== 'object') {
      throw new Error('decisionWeights must be an object');
    }
    patch.decisionWeights = body.decisionWeights;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('No valid config keys provided');
  }

  // Persist persisted fields to DB; maxIndexesPerRun / llmTimeoutMs are defaults-only
  await saveConfigToDB(patch);

  const dbConfig = await loadConfigFromDB();
  const config: TenantRuntimeConfig = { ...DEFAULTS, ...dbConfig };

  return {
    data: config,
    meta: {
      source: 'postgres',
      persisted: true,
      keys_updated: Object.keys(patch),
    },
  };
});
