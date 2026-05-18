import { createHash } from 'crypto';
import { RawTelemetryInput } from '../agents/llm-decision-agent';

// Stable, bucketed fingerprint that avoids noise churn
export interface FingerprintInput {
  indexName: string;
  sourcetype: string;
  retentionBucket: string;
  volumeBucket: string;
  utilizationBucket: string;
  searchFrequencyBucket: string;
  freshnessBucket: string;
  hasSecurityDetections: boolean;
  hasAlerts: boolean;
  dataCategory: string;
  sourceSystem: string;
}

// Bucketization functions to avoid noise churn
export function volumeBucket(gb: number): string {
  if (gb < 1) return 'TINY';
  if (gb < 10) return 'SMALL';
  if (gb < 100) return 'MEDIUM';
  return 'LARGE';
}

export function utilizationBucket(utilPercent: number): string {
  if (utilPercent < 5) return 'VERY_LOW';
  if (utilPercent < 20) return 'LOW';
  if (utilPercent < 60) return 'MEDIUM';
  return 'HIGH';
}

export function searchFrequencyBucket(searchCount: number): string {
  if (searchCount === 0) return 'NEVER_SEARCHED';
  if (searchCount < 5) return 'RARELY';
  if (searchCount < 50) return 'OCCASIONALLY';
  if (searchCount < 500) return 'FREQUENTLY';
  return 'VERY_FREQUENTLY';
}

export function freshnessBucket(daysSinceLastEvent: number): string {
  if (daysSinceLastEvent <= 7) return 'FRESH_0_7D';
  if (daysSinceLastEvent <= 30) return 'FRESH_7_30D';
  if (daysSinceLastEvent <= 90) return 'STALE_30_90D';
  return 'STALE_90PLUS_D';
}

export function retentionBucket(retentionDays: number): string {
  if (retentionDays <= 7) return 'SHORT_7D';
  if (retentionDays <= 30) return 'MEDIUM_30D';
  if (retentionDays <= 90) return 'LONG_90D';
  return 'VERYLONG_90PLUS_D';
}

// Stable stringify preserves key order for consistent hashing
function stableStringify(obj: any): string {
  const keys = Object.keys(obj).sort();
  return JSON.stringify(keys.map(k => [k, obj[k]]));
}

// Convert RawTelemetryInput to FingerprintInput with bucketized values
export function createFingerprintInput(metadata: RawTelemetryInput): FingerprintInput {
  // Parse lastEvent to compute days since last event
  let daysSinceLastEvent = 0;
  if (metadata.lastEvent) {
    try {
      const lastEventDate = new Date(metadata.lastEvent);
      const now = new Date();
      daysSinceLastEvent = Math.floor((now.getTime() - lastEventDate.getTime()) / (1000 * 60 * 60 * 24));
    } catch {
      daysSinceLastEvent = 999; // Default to very stale
    }
  }

  // Note: These values need to come from metadata
  // For now using placeholder logic - actual implementation depends on data available
  const searchCount = 0; // TODO: derive from SearchAudit or similar
  const hasSecurityDetections = false; // TODO: derive from SecurityCoverage
  const hasAlerts = false; // TODO: derive from alerts system
  const dataCategory = 'GENERAL'; // TODO: categorize
  const sourceSystem = metadata.sourcetype || 'UNKNOWN';

  return {
    indexName: metadata.index,
    sourcetype: metadata.sourcetype || 'UNKNOWN',
    retentionBucket: retentionBucket(metadata.retentionDays || 30),
    volumeBucket: volumeBucket(metadata.dailyAvgGb || 0),
    utilizationBucket: utilizationBucket(0), // TODO: compute actual utilization
    searchFrequencyBucket: searchFrequencyBucket(searchCount),
    freshnessBucket: freshnessBucket(daysSinceLastEvent),
    hasSecurityDetections,
    hasAlerts,
    dataCategory,
    sourceSystem,
  };
}

export function computeMetadataFingerprint(metadata: RawTelemetryInput): string {
  const fingerprintInput = createFingerprintInput(metadata);

  // Only include stable, bucketed fields - NEVER raw counts, timestamps, or volatile values
  const fingerprintPayload = {
    indexName: fingerprintInput.indexName,
    sourcetype: fingerprintInput.sourcetype,
    volumeBucket: fingerprintInput.volumeBucket,
    utilizationBucket: fingerprintInput.utilizationBucket,
    retentionBucket: fingerprintInput.retentionBucket,
    freshnessBucket: fingerprintInput.freshnessBucket,
    searchFrequencyBucket: fingerprintInput.searchFrequencyBucket,
    hasSecurityDetections: fingerprintInput.hasSecurityDetections,
    hasAlerts: fingerprintInput.hasAlerts,
    sourceSystem: fingerprintInput.sourceSystem,
    dataCategory: fingerprintInput.dataCategory,
  };

  return createHash('sha256').update(stableStringify(fingerprintPayload)).digest('hex');
}
