/**
 * EnvelopeNormalizationService
 *
 * Normalizes governance telemetry envelopes before canonicalization.
 * Ensures semantically identical envelopes always produce identical signatures
 * regardless of representation differences (float precision, timestamp format, casing, etc).
 *
 * Prevents signature drift from:
 * - { "latency": 1 } vs { "latency": 1.0 }
 * - "2026-05-18T12:00:00Z" vs "2026-05-18T12:00:00.000Z"
 * - "HEALTHY" vs "healthy"
 * - undefined fields vs omitted fields
 */

export interface NormalizationRules {
  // Numeric precision: round floats to N decimal places
  numericPrecisionDecimals: number; // default 2

  // Timestamp precision: round to nearest second
  timestampPrecisionMs: number; // default 1000 (1 second)

  // Casing: lowercase identifiers
  lowercaseIdentifiers: string[]; // fields to lowercase: ['route', 'status', 'healthStatus']

  // Undefined/null handling: include or exclude
  stripUndefinedFields: boolean; // default true
  stripNullFields: boolean; // default false (preserve explicit nulls)

  // Whitespace normalization
  normalizeWhitespace: boolean; // default true (trim strings)
}

const DEFAULT_NORMALIZATION_RULES: NormalizationRules = {
  numericPrecisionDecimals: 2,
  timestampPrecisionMs: 1000, // Round to nearest second
  lowercaseIdentifiers: [
    'route',
    'status',
    'healthStatus',
    'executionMode',
    'scope',
    'tier',
    'evaluationMethod',
    'algorithm',
    'seal_reason',
  ],
  stripUndefinedFields: true,
  stripNullFields: false,
  normalizeWhitespace: true,
};

export class EnvelopeNormalizationService {
  private static readonly RULES = DEFAULT_NORMALIZATION_RULES;

  /**
   * Normalize an envelope object before signing
   * Applies: numeric rounding, timestamp normalization, casing, field stripping
   */
  static normalizeForSigning(obj: any, rules: Partial<NormalizationRules> = {}): any {
    const finalRules = { ...this.RULES, ...rules };
    return this._normalize(obj, finalRules, new Set());
  }

  /**
   * Deep normalization with cycle detection
   */
  private static _normalize(obj: any, rules: NormalizationRules, visited: Set<any>): any {
    // Handle primitives
    if (obj === null) {
      return rules.stripNullFields ? undefined : null;
    }
    if (obj === undefined) {
      return undefined;
    }

    if (typeof obj === 'number') {
      // Round to specified decimal places
      return Math.round(obj * Math.pow(10, rules.numericPrecisionDecimals)) / Math.pow(10, rules.numericPrecisionDecimals);
    }

    if (typeof obj === 'string') {
      // Normalize whitespace if enabled
      if (rules.normalizeWhitespace) {
        obj = obj.trim();
      }
      // Check if this is an identifier that should be lowercased
      return obj; // Return as-is for now, case conversion done at field level
    }

    if (typeof obj === 'boolean' || typeof obj === 'bigint') {
      return obj;
    }

    // Handle objects and arrays
    if (typeof obj !== 'object') {
      return obj;
    }

    // Detect cycles
    if (visited.has(obj)) {
      throw new Error('NORMALIZATION_CYCLE_DETECTED: Circular reference in object');
    }

    visited.add(obj);

    try {
      if (Array.isArray(obj)) {
        return obj
          .map((item) => this._normalize(item, rules, visited))
          .filter((item) => !(rules.stripUndefinedFields && item === undefined));
      }

      // Normalize object
      const normalized: any = {};

      for (const [key, value] of Object.entries(obj)) {
        let normalizedValue = this._normalize(value, rules, visited);

        // Skip undefined fields if configured
        if (rules.stripUndefinedFields && normalizedValue === undefined) {
          continue;
        }

        // Apply lowercase transformation to specific fields
        if (typeof normalizedValue === 'string' && rules.lowercaseIdentifiers.includes(key)) {
          normalizedValue = normalizedValue.toLowerCase();
        }

        // Special handling for timestamp fields
        if (this._isTimestampField(key) && typeof normalizedValue === 'string') {
          normalizedValue = this._normalizeTimestamp(normalizedValue, rules.timestampPrecisionMs);
        }

        normalized[key] = normalizedValue;
      }

      return normalized;
    } finally {
      visited.delete(obj);
    }
  }

  /**
   * Check if a field name indicates a timestamp
   */
  private static _isTimestampField(fieldName: string): boolean {
    const timestampPatterns = ['At', 'Time', 'Date', 'Timestamp', 'Expires', 'Issued'];
    return timestampPatterns.some((pattern) => fieldName.includes(pattern));
  }

  /**
   * Normalize ISO8601 timestamp to precision boundary
   * E.g., "2026-05-18T12:00:00.123Z" → "2026-05-18T12:00:00Z" (1s precision)
   */
  private static _normalizeTimestamp(isoString: string, precisionMs: number): string {
    try {
      const date = new Date(isoString);
      const roundedTime = Math.floor(date.getTime() / precisionMs) * precisionMs;
      return new Date(roundedTime).toISOString();
    } catch {
      // If not a valid timestamp, return as-is
      return isoString;
    }
  }

  /**
   * Verify that two envelopes are semantically equivalent after normalization
   */
  static areEquivalent(obj1: any, obj2: any, rules: Partial<NormalizationRules> = {}): boolean {
    const finalRules = { ...this.RULES, ...rules };

    try {
      const norm1 = JSON.stringify(this.normalizeForSigning(obj1, finalRules));
      const norm2 = JSON.stringify(this.normalizeForSigning(obj2, finalRules));
      return norm1 === norm2;
    } catch {
      return false;
    }
  }

  /**
   * Get normalized representation for debugging/comparison
   */
  static getCanonicalForm(obj: any, rules: Partial<NormalizationRules> = {}): string {
    const finalRules = { ...this.RULES, ...rules };
    const normalized = this.normalizeForSigning(obj, finalRules);
    return JSON.stringify(normalized, null, 2);
  }
}
