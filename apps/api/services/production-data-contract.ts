/**
 * P0.5: Production Data Contract
 *
 * Enforces required schema for telemetry data ingestion.
 * Prevents silent failures by explicitly validating all required fields.
 */

export interface TelemetryDataRequired {
  sourcetype: string;
  daily_gb: number;
  storage_cost: number;
  searches: number;
  dashboards: number;
  scheduled_searches: number;
  unique_users: number;
  mitre_techniques: number;
  lantern_usecases: number;
  parsing_errors: number;
  date_errors: number;
}

export interface TelemetryDataOptional {
  owner?: string;
  business_unit?: string;
  retention_days?: number;
}

export type TelemetryDataFull = TelemetryDataRequired & TelemetryDataOptional;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate incoming telemetry data against the contract
 * Fails immediately if any required field is missing or invalid
 */
export function validateTelemetryData(data: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields validation
  const requiredFields: (keyof TelemetryDataRequired)[] = [
    'sourcetype',
    'daily_gb',
    'storage_cost',
    'searches',
    'dashboards',
    'scheduled_searches',
    'unique_users',
    'mitre_techniques',
    'lantern_usecases',
    'parsing_errors',
    'date_errors',
  ];

  for (const field of requiredFields) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }

    const value = data[field];

    // Type validation
    if (field === 'sourcetype') {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`Invalid ${field}: must be non-empty string`);
      }
    } else {
      // Numeric fields
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`Invalid ${field}: must be a finite number`);
      }
      if (value < 0) {
        errors.push(`Invalid ${field}: must be non-negative`);
      }
    }
  }

  // Optional fields validation
  if ('owner' in data && data.owner !== null && typeof data.owner !== 'string') {
    errors.push('Invalid owner: must be string or null');
  }

  if ('business_unit' in data && data.business_unit !== null && typeof data.business_unit !== 'string') {
    errors.push('Invalid business_unit: must be string or null');
  }

  if ('retention_days' in data && data.retention_days !== null) {
    if (typeof data.retention_days !== 'number' || !Number.isFinite(data.retention_days)) {
      errors.push('Invalid retention_days: must be number or null');
    }
    if (data.retention_days < 0) {
      errors.push('Invalid retention_days: must be non-negative');
    }
  }

  // Business logic warnings
  if (typeof data.daily_gb === 'number' && data.daily_gb === 0) {
    warnings.push('daily_gb is 0 — sourcetype may be inactive');
  }

  if (data.searches === 0 && data.dashboards === 0 && data.scheduled_searches === 0) {
    warnings.push('No usage detected (searches, dashboards, scheduled searches all 0)');
  }

  if (data.mitre_techniques === 0 && data.lantern_usecases === 0) {
    warnings.push('No MITRE or Lantern detection coverage');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a batch of telemetry records
 * Returns first error encountered, or summary of warnings
 */
export function validateTelemetryBatch(records: any[]): {
  allValid: boolean;
  failureIndex?: number;
  failureReason?: string;
  warnings: string[];
} {
  const allWarnings: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const result = validateTelemetryData(records[i]);

    if (!result.valid) {
      return {
        allValid: false,
        failureIndex: i,
        failureReason: `Record ${i} validation failed: ${result.errors.join('; ')}`,
        warnings: allWarnings,
      };
    }

    allWarnings.push(...result.warnings.map(w => `Record ${i}: ${w}`));
  }

  return {
    allValid: true,
    warnings: allWarnings,
  };
}

/**
 * Get the contract schema for documentation
 */
export function getContractSchema() {
  return {
    required: {
      sourcetype: { type: 'string', description: 'Index or sourcetype name (e.g., "endpoint:edr")' },
      daily_gb: { type: 'number', description: 'Daily ingest volume in GB' },
      storage_cost: { type: 'number', description: 'Storage cost (e.g., $/GB/year)' },
      searches: { type: 'number', description: 'Count of searches using this sourcetype' },
      dashboards: { type: 'number', description: 'Count of dashboard panels using this sourcetype' },
      scheduled_searches: { type: 'number', description: 'Count of scheduled searches' },
      unique_users: { type: 'number', description: 'Unique users accessing this sourcetype' },
      mitre_techniques: { type: 'number', description: 'MITRE ATT&CK techniques detected' },
      lantern_usecases: { type: 'number', description: 'Lantern use cases covered' },
      parsing_errors: { type: 'number', description: 'Count of parsing errors' },
      date_errors: { type: 'number', description: 'Count of date parsing errors' },
    },
    optional: {
      owner: { type: 'string | null', description: 'Sourcetype owner/team' },
      business_unit: { type: 'string | null', description: 'Business unit responsible' },
      retention_days: { type: 'number | null', description: 'Retention period in days' },
    },
  };
}
