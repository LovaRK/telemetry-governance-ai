/**
 * Splunk Queries Service — Stub Implementation
 *
 * In web-only build, these queries are unavailable.
 * Full implementation requires Splunk client API.
 */

import { SplunkClient } from './splunk-client';

export interface FieldUsageResult {
  sourcetype: string;
  fieldsIndexed: number;
  fieldsUsed: number;
  optimizationPct: number;
}

export interface SecurityCoverageResult {
  sourcetype: string;
  techniquesCovered: string[];
  coverageCount: number;
  detectionCapability: string;
}

export interface QualityHotspotResult {
  sourcetype: string;
  parseErrorCount: number;
  parseErrorRate: number;
  impactLevel: 'High' | 'Medium' | 'Low';
}

export async function queryFieldUsage(
  splunk: SplunkClient,
  lookbackDays: number = 30
): Promise<FieldUsageResult[]> {
  console.warn('[FieldUsage] Stub: not available in web-only build');
  return [];
}

export async function querySecurityCoverage(
  splunk: SplunkClient,
  lookbackDays: number = 30
): Promise<SecurityCoverageResult[]> {
  console.warn('[SecurityCoverage] Stub: not available in web-only build');
  return [];
}

export async function queryDataQualityMetrics(
  splunk: SplunkClient,
  lookbackDays: number = 30
): Promise<QualityHotspotResult[]> {
  console.warn('[QualityHotspots] Stub: not available in web-only build');
  return [];
}
