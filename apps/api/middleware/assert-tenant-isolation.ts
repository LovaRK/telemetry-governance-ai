/**
 * Tenant Isolation Enforcement Middleware
 *
 * MANDATORY: Every cache key, query, snapshot, audit row, LLM log, and policy
 * evaluation MUST include tenant_id. Multi-tenant leakage is catastrophic.
 *
 * This module provides:
 * 1. assertTenantIsolation() — throws on missing/invalid tenant_id
 * 2. withTenantGuard()      — wraps async operations with isolation check
 * 3. buildTenantCacheKey()  — ensures cache keys are scoped to tenant
 * 4. validateTenantId()     — returns typed result for conditional flows
 *
 * Usage:
 * ```typescript
 * // In a service method
 * assertTenantIsolation(tenantId, 'TelemetryService.getSnapshots');
 *
 * // Wrapping an async operation
 * return withTenantGuard(tenantId, () => db.query(sql, [tenantId]));
 *
 * // Scoped cache key
 * const key = buildTenantCacheKey(tenantId, 'kpis', { window: '24h' });
 * ```
 */

// ─────────────────────────────────────────────
// Error Type
// ─────────────────────────────────────────────

export class TenantIsolationViolation extends Error {
  public readonly context: string;
  public readonly violationType: 'missing' | 'invalid' | 'system_reserved' | 'cross_tenant';

  constructor(
    context: string,
    violationType: 'missing' | 'invalid' | 'system_reserved' | 'cross_tenant',
    detail?: string
  ) {
    super(
      `[TENANT_ISOLATION_VIOLATION] Context: "${context}". ` +
      `Type: ${violationType}. ${detail ? `Detail: ${detail}` : ''}`
    );
    this.name = 'TenantIsolationViolation';
    this.context = context;
    this.violationType = violationType;
  }
}

// ─────────────────────────────────────────────
// Validation Constants
// ─────────────────────────────────────────────

/**
 * System-level tenant IDs that should NOT be used for user data queries.
 * Allowed in internal/system operations but must never leak into user-facing responses.
 */
const SYSTEM_RESERVED_IDS = new Set(['__none__', '__system__', 'undefined', 'null', 'nil', 'anonymous']);

/**
 * Pattern for a valid tenant ID: alphanumeric, dashes, underscores, min 2 chars.
 * Allows SYSTEM (used for platform-level config only).
 */
const VALID_TENANT_PATTERN = /^[a-zA-Z0-9_-]{2,128}$/;

// ─────────────────────────────────────────────
// Core Assertion
// ─────────────────────────────────────────────

/**
 * Assert that a tenant_id is valid and present.
 * Throws TenantIsolationViolation immediately on violation.
 *
 * @param tenantId - The tenant ID to validate
 * @param context  - Human-readable context string for the error log
 * @throws TenantIsolationViolation
 */
export function assertTenantIsolation(
  tenantId: string | null | undefined,
  context: string
): asserts tenantId is string {
  if (tenantId === null || tenantId === undefined || tenantId.trim() === '') {
    console.error('[TENANT_ISOLATION_VIOLATION]', {
      context,
      type: 'missing',
      tenant_id: tenantId,
      timestamp: new Date().toISOString()
    });
    throw new TenantIsolationViolation(context, 'missing', `tenant_id is ${tenantId}`);
  }

  const normalized = tenantId.trim().toLowerCase();

  if (SYSTEM_RESERVED_IDS.has(normalized)) {
    console.error('[TENANT_ISOLATION_VIOLATION]', {
      context,
      type: 'system_reserved',
      tenant_id: tenantId,
      timestamp: new Date().toISOString()
    });
    throw new TenantIsolationViolation(context, 'system_reserved', `"${tenantId}" is a reserved identifier`);
  }

  if (!VALID_TENANT_PATTERN.test(tenantId.trim())) {
    console.error('[TENANT_ISOLATION_VIOLATION]', {
      context,
      type: 'invalid',
      tenant_id: tenantId,
      timestamp: new Date().toISOString()
    });
    throw new TenantIsolationViolation(context, 'invalid', `"${tenantId}" fails pattern ${VALID_TENANT_PATTERN}`);
  }
}

// ─────────────────────────────────────────────
// Guard Wrapper
// ─────────────────────────────────────────────

/**
 * Wrap an async operation with tenant isolation enforcement.
 * The tenant_id is validated before the operation runs.
 *
 * @param tenantId - Tenant to validate
 * @param fn       - Async operation to execute if validation passes
 * @param context  - Context string for error reporting
 * @returns Result of fn()
 */
export async function withTenantGuard<T>(
  tenantId: string | null | undefined,
  fn: () => Promise<T>,
  context = 'withTenantGuard'
): Promise<T> {
  assertTenantIsolation(tenantId, context);
  return fn();
}

// ─────────────────────────────────────────────
// Cache Key Builder
// ─────────────────────────────────────────────

/**
 * Build a tenant-scoped cache key.
 * Ensures cross-tenant cache pollution is structurally impossible.
 *
 * @param tenantId  - Tenant scope
 * @param namespace - Cache namespace (e.g., 'kpis', 'governance', 'snapshots')
 * @param params    - Additional discriminators (sorted for determinism)
 * @returns Cache key string: `t:{tenantId}:{namespace}:{...params}`
 */
export function buildTenantCacheKey(
  tenantId: string,
  namespace: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  assertTenantIsolation(tenantId, `buildTenantCacheKey:${namespace}`);

  if (!params || Object.keys(params).length === 0) {
    return `t:${tenantId}:${namespace}`;
  }

  // Sort params for deterministic key generation
  const sortedParams = Object.keys(params)
    .sort()
    .filter(k => params[k] !== undefined)
    .map(k => `${k}=${params[k]}`)
    .join(':');

  return `t:${tenantId}:${namespace}:${sortedParams}`;
}

// ─────────────────────────────────────────────
// Validation (Non-throwing)
// ─────────────────────────────────────────────

export interface TenantValidationResult {
  valid: boolean;
  tenantId?: string;
  error?: string;
}

/**
 * Validate a tenant_id without throwing.
 * Use for conditional flows where you want to handle the error yourself.
 */
export function validateTenantId(
  tenantId: string | null | undefined
): TenantValidationResult {
  if (tenantId === null || tenantId === undefined || tenantId.trim() === '') {
    return { valid: false, error: 'tenant_id is missing' };
  }

  const normalized = tenantId.trim().toLowerCase();

  if (SYSTEM_RESERVED_IDS.has(normalized)) {
    return { valid: false, error: `"${tenantId}" is a system-reserved identifier` };
  }

  if (!VALID_TENANT_PATTERN.test(tenantId.trim())) {
    return { valid: false, error: `"${tenantId}" does not match required pattern` };
  }

  return { valid: true, tenantId: tenantId.trim() };
}

// ─────────────────────────────────────────────
// Express Middleware
// ─────────────────────────────────────────────

/**
 * Express middleware that validates tenant_id from:
 * 1. X-Tenant-ID header
 * 2. Request body .tenant_id
 * 3. Query parameter ?tenant_id=
 *
 * Sets req.tenantId for downstream handlers.
 * Returns 400 if tenant_id is missing or invalid.
 */
export function tenantIsolationMiddleware() {
  return (req: any, res: any, next: any): void => {
    const tenantId =
      req.headers['x-tenant-id'] ||
      req.body?.tenant_id ||
      req.query?.tenant_id;

    const result = validateTenantId(tenantId);

    if (!result.valid) {
      res.status(400).json({
        error: 'tenant_isolation_violation',
        message: result.error,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Attach validated tenant_id to request for downstream use
    req.tenantId = result.tenantId;
    next();
  };
}
