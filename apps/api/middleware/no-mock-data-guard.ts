/**
 * No-Mock-Data Guard
 *
 * Enforces the platform's strictest data contract:
 * Production API responses MUST NOT contain synthetic, mock, demo, or hardcoded data.
 *
 * CRITICAL INVARIANTS:
 * - Production: throw MockDataViolation on any mock/synthetic pattern detection
 * - Sandbox (ALLOW_SYNTHETIC_DATA=true): log warning, do not throw
 * - Sandbox (ALLOW_SYNTHETIC_DATA=false, default): throw — same as production
 *
 * This guard operates at TWO boundaries:
 * 1. API response exit: validate payload before returning to client
 * 2. Agent output entry: validate LLM output before persisting to agent_decisions
 *
 * Usage:
 * ```typescript
 * // In a route handler
 * assertNoMockData(responsePayload, 'GET /api/telemetry');
 *
 * // After LLM inference
 * assertNoMockData(llmOutput, 'llm-decision-agent:tier_classification');
 * ```
 */

import { IS_PRODUCTION, ALLOW_SYNTHETIC_DATA, SYNTHETIC_DATA_HARD_FAIL } from '@core/constants/environment-gates';

// ─────────────────────────────────────────────
// Mock Data Violation Error
// ─────────────────────────────────────────────

export class MockDataViolation extends Error {
  public readonly context: string;
  public readonly detectedPattern: string;
  public readonly isProduction: boolean;

  constructor(context: string, detectedPattern: string) {
    super(
      `[MOCK_DATA_VIOLATION] Synthetic/mock data detected in "${context}". ` +
      `Pattern: "${detectedPattern}". ` +
      `Set ALLOW_SYNTHETIC_DATA=true in sandbox to permit synthetic data.`
    );
    this.name = 'MockDataViolation';
    this.context = context;
    this.detectedPattern = detectedPattern;
    this.isProduction = IS_PRODUCTION;
  }
}

// ─────────────────────────────────────────────
// Detection Patterns
// ─────────────────────────────────────────────

/**
 * String patterns that indicate synthetic/mock data.
 * Checked case-insensitively against all string values.
 */
const MOCK_STRING_PATTERNS = [
  'mock_',
  'mock-',
  '_mock',
  '-mock',
  'synthetic',
  'demo_',
  'demo-',
  '_demo',
  '-demo',
  'seeded_',
  'test_data',
  'fake_',
  '_fake',
  'placeholder',
  'hardcoded',
  'dummy_',
  'sample_data',
  'lorem ipsum',
  'example.com',
] as const;

/**
 * Keys whose presence indicates a synthetic payload.
 * Checked case-insensitively against all object keys.
 */
const MOCK_KEY_PATTERNS = [
  'is_mock',
  'is_synthetic',
  'is_demo',
  'is_seeded',
  'synthetic',
  '_synthetic',
  'mock_source',
  'demo_source',
  '_seeded',
] as const;

/**
 * Detect suspiciously uniform arrays (all identical values = likely hardcoded).
 * Only flags arrays of numbers where ALL values are identical AND the array length > 3.
 */
function isSuspiciouslyUniformArray(arr: number[]): boolean {
  if (arr.length <= 3) return false;
  const first = arr[0];
  return arr.every(v => v === first);
}

// ─────────────────────────────────────────────
// Deep Scanner
// ─────────────────────────────────────────────

interface ScanResult {
  found: boolean;
  pattern: string;
  path: string;
}

function scanPayload(
  value: unknown,
  path: string,
  depth: number
): ScanResult {
  // Depth limit: prevent stack overflow on deeply nested objects
  if (depth > 12) {
    return { found: false, pattern: '', path };
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    for (const pattern of MOCK_STRING_PATTERNS) {
      if (lower.includes(pattern)) {
        return { found: true, pattern: `string contains "${pattern}"`, path };
      }
    }
    return { found: false, pattern: '', path };
  }

  if (Array.isArray(value)) {
    // Check for uniform numeric arrays
    if (value.length > 3 && value.every(v => typeof v === 'number')) {
      if (isSuspiciouslyUniformArray(value as number[])) {
        return {
          found: true,
          pattern: `uniform numeric array [${value.slice(0, 3).join(',')},...] at ${path}`,
          path
        };
      }
    }

    // Recursively scan array elements
    for (let i = 0; i < Math.min(value.length, 20); i++) {
      const result = scanPayload(value[i], `${path}[${i}]`, depth + 1);
      if (result.found) return result;
    }
    return { found: false, pattern: '', path };
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      // Check key name
      const keyLower = key.toLowerCase();
      for (const mockKey of MOCK_KEY_PATTERNS) {
        if (keyLower === mockKey || keyLower.includes(mockKey)) {
          return {
            found: true,
            pattern: `key "${key}" matches mock pattern "${mockKey}"`,
            path: `${path}.${key}`
          };
        }
      }

      // Recursively scan value
      const result = scanPayload(obj[key], `${path}.${key}`, depth + 1);
      if (result.found) return result;
    }
    return { found: false, pattern: '', path };
  }

  return { found: false, pattern: '', path };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Assert that a payload contains no mock/synthetic data.
 *
 * @param payload - Any value to scan (object, array, string, etc.)
 * @param context - Human-readable context for the violation log (e.g., 'GET /api/telemetry')
 * @throws MockDataViolation if mock data detected AND SYNTHETIC_DATA_HARD_FAIL is true
 *
 * Behavior:
 * - Production (IS_PRODUCTION=true): ALWAYS throws on detection
 * - Sandbox (ALLOW_SYNTHETIC_DATA=false): throws on detection
 * - Sandbox (ALLOW_SYNTHETIC_DATA=true): logs warning, does NOT throw
 */
export function assertNoMockData(payload: unknown, context: string): void {
  const result = scanPayload(payload, '$', 0);

  if (!result.found) {
    return; // Clean
  }

  const logPayload = {
    context,
    pattern: result.pattern,
    path: result.path,
    is_production: IS_PRODUCTION,
    allow_synthetic_data: ALLOW_SYNTHETIC_DATA,
    hard_fail: SYNTHETIC_DATA_HARD_FAIL,
    timestamp: new Date().toISOString()
  };

  if (SYNTHETIC_DATA_HARD_FAIL) {
    console.error('[MOCK_DATA_VIOLATION:HARD_FAIL]', logPayload);
    throw new MockDataViolation(context, result.pattern);
  } else {
    // Sandbox with ALLOW_SYNTHETIC_DATA=true: warn only
    console.warn('[MOCK_DATA_VIOLATION:SANDBOX_WARN]', logPayload);
  }
}

/**
 * Validate that an API response is DB-backed.
 * Returns a 503 if the result is empty in production (indicating no real data).
 *
 * Use this for routes that MUST have data when the system is healthy:
 * - /api/telemetry (should always have snapshots after first pipeline run)
 * - /api/agent-decisions (should have decisions after first LLM run)
 *
 * @param result - The query result to check
 * @param routeName - Route name for logging
 * @returns { empty: boolean } — caller decides how to handle empty vs non-empty
 */
export function checkDbBacked(
  result: unknown,
  routeName: string
): { empty: boolean; reason?: string } {
  const isEmpty =
    result === null ||
    result === undefined ||
    (Array.isArray(result) && result.length === 0) ||
    (typeof result === 'object' && result !== null && Object.keys(result).length === 0);

  if (!isEmpty) {
    return { empty: false };
  }

  const reason = `Route "${routeName}" returned empty result`;

  if (IS_PRODUCTION) {
    console.error('[DB_BACKED_VIOLATION:PRODUCTION]', {
      route: routeName,
      reason,
      timestamp: new Date().toISOString()
    });
  } else {
    console.warn('[DB_BACKED_EMPTY:SANDBOX]', {
      route: routeName,
      reason,
      allow_synthetic: ALLOW_SYNTHETIC_DATA,
      timestamp: new Date().toISOString()
    });
  }

  return { empty: true, reason };
}

/**
 * Scan only — does not throw. Returns detection result for conditional logic.
 * Use when you want to log or tag the response rather than block it.
 */
export function detectMockData(payload: unknown): { detected: boolean; pattern?: string; path?: string } {
  const result = scanPayload(payload, '$', 0);
  if (!result.found) return { detected: false };
  return { detected: true, pattern: result.pattern, path: result.path };
}
