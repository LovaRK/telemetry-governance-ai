/**
 * Environment Gate Constants
 *
 * Single source of truth for environment-dependent behavior.
 * Import this instead of reading process.env directly in business logic.
 *
 * CRITICAL INVARIANTS:
 * - Production must NEVER serve synthetic / mock data
 * - Sandbox MUST be isolated from production IPs
 * - LLM must default to local Ollama (Anthropic only with explicit opt-in)
 */

// ─────────────────────────────────────────────
// Environment Identity
// ─────────────────────────────────────────────

export const APP_ENV: 'sandbox' | 'production' =
  process.env.APP_ENV === 'production' ? 'production' : 'sandbox';

export const IS_PRODUCTION = APP_ENV === 'production';
export const IS_SANDBOX = APP_ENV === 'sandbox';
export const NODE_ENV = process.env.NODE_ENV ?? 'development';

// ─────────────────────────────────────────────
// Network Isolation
// ─────────────────────────────────────────────

/** Approved sandbox Splunk IP. Only this IP is reachable in sandbox mode. */
export const SANDBOX_IP = '144.202.48.85';

/** Production Splunk IP. Blocked in sandbox. */
export const PRODUCTION_IP = '45.76.167.6';

// ─────────────────────────────────────────────
// Data Purity Gates
// ─────────────────────────────────────────────

/**
 * Whether synthetic/mock data is permitted.
 *
 * Defaults to FALSE. Must be explicitly set to 'true' in sandbox only.
 * In production, this is ALWAYS false regardless of env var.
 *
 * Usage:
 * - Sandbox testing: set ALLOW_SYNTHETIC_DATA=true
 * - Production: hard-fail on any synthetic payload detection
 */
export const ALLOW_SYNTHETIC_DATA =
  IS_SANDBOX && process.env.ALLOW_SYNTHETIC_DATA === 'true';

/**
 * Whether to throw (true) or warn (false) on synthetic data detection.
 * Production: always throw. Sandbox: depends on ALLOW_SYNTHETIC_DATA.
 */
export const SYNTHETIC_DATA_HARD_FAIL = IS_PRODUCTION || !ALLOW_SYNTHETIC_DATA;

// ─────────────────────────────────────────────
// LLM Routing Gates
// ─────────────────────────────────────────────

/**
 * Whether Anthropic fallback is enabled.
 * Requires BOTH flags set — never implicit.
 */
export const ENABLE_ANTHROPIC_FALLBACK =
  process.env.ENABLE_ANTHROPIC_FALLBACK === 'true' &&
  Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Ollama base URL. Defaults to local.
 */
export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

/**
 * Default LLM model for local inference.
 */
export const DEFAULT_LOCAL_MODEL =
  process.env.DEFAULT_LOCAL_MODEL ?? 'llama3.1:8b';

// ─────────────────────────────────────────────
// Pipeline Gates
// ─────────────────────────────────────────────

/**
 * Max indexes processed per pipeline run (circuit breaker).
 */
export const MAX_INDEXES_PER_RUN =
  parseInt(process.env.MAX_INDEXES_PER_RUN ?? '1000', 10);

/**
 * Worker thread count. MUST stay at 1 for Ollama memory constraint.
 */
export const WORKER_BATCH_SIZE =
  parseInt(process.env.BATCH_SIZE ?? '1', 10);

// ─────────────────────────────────────────────
// Governance Gates
// ─────────────────────────────────────────────

/**
 * Governance mode. Defaults to SHADOW (zero production blocking).
 */
export const GOVERNANCE_MODE =
  process.env.APP_GOVERNANCE_MODE ?? 'SHADOW';

// ─────────────────────────────────────────────
// Diagnostic helper
// ─────────────────────────────────────────────

export function logEnvironmentGates(): void {
  console.log('[ENVIRONMENT_GATES]', {
    app_env: APP_ENV,
    is_production: IS_PRODUCTION,
    allow_synthetic_data: ALLOW_SYNTHETIC_DATA,
    synthetic_data_hard_fail: SYNTHETIC_DATA_HARD_FAIL,
    anthropic_fallback_enabled: ENABLE_ANTHROPIC_FALLBACK,
    ollama_base_url: OLLAMA_BASE_URL,
    default_local_model: DEFAULT_LOCAL_MODEL,
    governance_mode: GOVERNANCE_MODE,
    max_indexes_per_run: MAX_INDEXES_PER_RUN,
    worker_batch_size: WORKER_BATCH_SIZE,
    timestamp: new Date().toISOString()
  });
}
