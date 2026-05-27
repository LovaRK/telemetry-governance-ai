/**
 * CANONICAL TELEMETRY CONTRACT
 *
 * Every raw Splunk payload normalizes into this shape before scoring.
 * Scoring only consumes CanonicalTelemetry — never raw payloads directly.
 *
 * This decouples scoring from Splunk's sourcetype naming conventions,
 * preventing KPI drift when sourcetypes are renamed or reorganized.
 */

import type { UtilizationInputs, DetectionInputs, QualityInputs } from '../engine/types';

export type CanonicalCategory =
  | 'security'
  | 'endpoint'
  | 'infra'
  | 'network'
  | 'cloud'
  | 'application'
  | 'generic';

export type NormalizationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CanonicalTelemetry {
  /** Normalized sourcetype identifier (e.g. "windows_security", "cisco_asa") */
  sourceType: string;
  /** Business-aligned category */
  category: CanonicalCategory;
  /** Operating channel (e.g. "security", "firewall", "identity", "system") */
  channel?: string;
  /** Raw event count from Splunk */
  events: number;
  /** Daily ingestion volume in GB */
  volumeGb: number;
  /** Utilization inputs for scoring (after attribution weighting) */
  utilizationInputs: UtilizationInputs;
  /** Detection inputs for scoring */
  detectionInputs: DetectionInputs;
  /** Quality inputs for scoring */
  qualityInputs: QualityInputs;
  /** Original raw Splunk metadata preserved for audit */
  raw: Record<string, unknown>;
  /** How confident we are in this normalization */
  confidence: NormalizationConfidence;
}

export interface NormalizationResult {
  canonical: CanonicalTelemetry[];
  errors: NormalizationError[];
}

export interface NormalizationError {
  rawSourcetype: string;
  rawIndex: string;
  message: string;
}

export function isCanonicalCategory(val: string): val is CanonicalCategory {
  return ['security', 'endpoint', 'infra', 'network', 'cloud', 'application', 'generic'].includes(val);
}
