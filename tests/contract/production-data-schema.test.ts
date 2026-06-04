/**
 * P0.5: Production Data Contract Testing
 *
 * Verify that telemetry data validation works correctly
 * Prevent silent ingestion failures
 */

import {
  validateTelemetryData,
  validateTelemetryBatch,
  getContractSchema,
} from '../../apps/api/services/production-data-contract';

describe('P0.5: Production Data Contract Validation', () => {
  // ────────────────────────────────────────────────────────────
  // Valid Data Tests
  // ────────────────────────────────────────────────────────────

  test('accepts valid telemetry record with all required fields', () => {
    const validRecord = {
      sourcetype: 'endpoint:edr',
      daily_gb: 5.2,
      storage_cost: 125.00,
      searches: 42,
      dashboards: 15,
      scheduled_searches: 8,
      unique_users: 23,
      mitre_techniques: 45,
      lantern_usecases: 12,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(validRecord);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('accepts valid record with optional fields', () => {
    const validRecord = {
      sourcetype: 'network:firewall',
      daily_gb: 12.5,
      storage_cost: 500.00,
      searches: 100,
      dashboards: 30,
      scheduled_searches: 20,
      unique_users: 50,
      mitre_techniques: 60,
      lantern_usecases: 25,
      parsing_errors: 5,
      date_errors: 2,
      owner: 'Security Team',
      business_unit: 'Infrastructure',
      retention_days: 365,
    };

    const result = validateTelemetryData(validRecord);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────
  // Missing Field Tests
  // ────────────────────────────────────────────────────────────

  test('rejects record missing required field: sourcetype', () => {
    const invalidRecord = {
      // sourcetype missing
      daily_gb: 5.2,
      storage_cost: 125.00,
      searches: 42,
      dashboards: 15,
      scheduled_searches: 8,
      unique_users: 23,
      mitre_techniques: 45,
      lantern_usecases: 12,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(invalidRecord);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: sourcetype');
  });

  test('rejects record missing multiple required fields', () => {
    const invalidRecord = {
      sourcetype: 'test',
      // daily_gb missing
      // storage_cost missing
      searches: 42,
    };

    const result = validateTelemetryData(invalidRecord);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });

  // ────────────────────────────────────────────────────────────
  // Type Validation Tests
  // ────────────────────────────────────────────────────────────

  test('rejects record with invalid type: sourcetype as number', () => {
    const invalidRecord = {
      sourcetype: 123, // Should be string
      daily_gb: 5.2,
      storage_cost: 125.00,
      searches: 42,
      dashboards: 15,
      scheduled_searches: 8,
      unique_users: 23,
      mitre_techniques: 45,
      lantern_usecases: 12,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(invalidRecord);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sourcetype'))).toBe(true);
  });

  test('rejects record with invalid type: daily_gb as string', () => {
    const invalidRecord = {
      sourcetype: 'test',
      daily_gb: '5.2', // Should be number
      storage_cost: 125.00,
      searches: 42,
      dashboards: 15,
      scheduled_searches: 8,
      unique_users: 23,
      mitre_techniques: 45,
      lantern_usecases: 12,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(invalidRecord);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('daily_gb'))).toBe(true);
  });

  test('rejects record with NaN numeric value', () => {
    const invalidRecord = {
      sourcetype: 'test',
      daily_gb: NaN, // Invalid
      storage_cost: 125.00,
      searches: 42,
      dashboards: 15,
      scheduled_searches: 8,
      unique_users: 23,
      mitre_techniques: 45,
      lantern_usecases: 12,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(invalidRecord);

    expect(result.valid).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // Range Validation Tests
  // ────────────────────────────────────────────────────────────

  test('rejects record with negative daily_gb', () => {
    const invalidRecord = {
      sourcetype: 'test',
      daily_gb: -5.2, // Negative not allowed
      storage_cost: 125.00,
      searches: 42,
      dashboards: 15,
      scheduled_searches: 8,
      unique_users: 23,
      mitre_techniques: 45,
      lantern_usecases: 12,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(invalidRecord);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('non-negative'))).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // Business Logic Warning Tests
  // ────────────────────────────────────────────────────────────

  test('warns when daily_gb is zero', () => {
    const record = {
      sourcetype: 'test',
      daily_gb: 0, // Inactive sourcetype
      storage_cost: 0,
      searches: 0,
      dashboards: 0,
      scheduled_searches: 0,
      unique_users: 0,
      mitre_techniques: 0,
      lantern_usecases: 0,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(record);

    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('daily_gb is 0'))).toBe(true);
  });

  test('warns when no usage detected', () => {
    const record = {
      sourcetype: 'test',
      daily_gb: 1.0,
      storage_cost: 50,
      searches: 0,
      dashboards: 0,
      scheduled_searches: 0,
      unique_users: 5,
      mitre_techniques: 10,
      lantern_usecases: 5,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(record);

    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('No usage detected'))).toBe(true);
  });

  test('warns when no detection coverage', () => {
    const record = {
      sourcetype: 'test',
      daily_gb: 1.0,
      storage_cost: 50,
      searches: 10,
      dashboards: 5,
      scheduled_searches: 2,
      unique_users: 5,
      mitre_techniques: 0,
      lantern_usecases: 0,
      parsing_errors: 0,
      date_errors: 0,
    };

    const result = validateTelemetryData(record);

    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('No MITRE or Lantern'))).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // Batch Validation Tests
  // ────────────────────────────────────────────────────────────

  test('accepts valid batch of records', () => {
    const batch = [
      {
        sourcetype: 'endpoint:edr',
        daily_gb: 5.2,
        storage_cost: 125.00,
        searches: 42,
        dashboards: 15,
        scheduled_searches: 8,
        unique_users: 23,
        mitre_techniques: 45,
        lantern_usecases: 12,
        parsing_errors: 0,
        date_errors: 0,
      },
      {
        sourcetype: 'network:firewall',
        daily_gb: 12.5,
        storage_cost: 500.00,
        searches: 100,
        dashboards: 30,
        scheduled_searches: 20,
        unique_users: 50,
        mitre_techniques: 60,
        lantern_usecases: 25,
        parsing_errors: 5,
        date_errors: 2,
      },
    ];

    const result = validateTelemetryBatch(batch);

    expect(result.allValid).toBe(true);
    expect(result.failureIndex).toBeUndefined();
  });

  test('rejects batch with invalid record at index 1', () => {
    const batch = [
      {
        sourcetype: 'endpoint:edr',
        daily_gb: 5.2,
        storage_cost: 125.00,
        searches: 42,
        dashboards: 15,
        scheduled_searches: 8,
        unique_users: 23,
        mitre_techniques: 45,
        lantern_usecases: 12,
        parsing_errors: 0,
        date_errors: 0,
      },
      {
        sourcetype: 'network:firewall',
        // Missing daily_gb
        storage_cost: 500.00,
        searches: 100,
      },
    ];

    const result = validateTelemetryBatch(batch);

    expect(result.allValid).toBe(false);
    expect(result.failureIndex).toBe(1);
    expect(result.failureReason).toContain('validation failed');
  });

  // ────────────────────────────────────────────────────────────
  // Schema Documentation Test
  // ────────────────────────────────────────────────────────────

  test('provides contract schema documentation', () => {
    const schema = getContractSchema();

    expect(schema.required).toBeDefined();
    expect(schema.optional).toBeDefined();
    expect(schema.required.sourcetype).toBeDefined();
    expect(schema.required.daily_gb).toBeDefined();
    expect(schema.optional.owner).toBeDefined();
  });
});
