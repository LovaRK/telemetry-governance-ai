/**
 * NORMALIZATION ORCHESTRATOR
 *
 * Routes each raw Splunk telemetry entry through the appropriate normalizer.
 * Order matters: specific normalizers (windows, syslog, cloud) run before
 * the generic fallback. The first normalizer that returns a non-null result wins.
 *
 * Errors are collected but never thrown — the system always produces a result.
 */

import { normalizeWindows } from './windows';
import { normalizeSyslog } from './syslog';
import { normalizeCloud } from './cloud';
import { normalizeGeneric } from './generic';
import type { CanonicalTelemetry, NormalizationResult, NormalizationError } from './canonical';

export type { CanonicalTelemetry, CanonicalCategory, NormalizationResult, NormalizationError, NormalizationConfidence } from './canonical';
export { computeNormalizationDelta, validateCanonical } from './contracts';
export type { NormalizationDelta } from './contracts';

interface RawTelemetryEntry {
  index: string;
  sourcetype?: string | null;
  dailyAvgGb: number;
  totalEvents: number;
  retentionDays: number;
  costPerGbPerDay: number;
  precomputedScores?: {
    utilizationScore: number;
    detectionScore: number;
    qualityScore: number;
    compositeScore: number;
    tier: string;
    detectionGap: boolean;
    operationalGap: boolean;
    alertCount: number;
    scheduledSearchCount: number;
    dashboardPanelCount: number;
    distinctUserCount: number;
    adHocSearchCount: number;
    mitreTechniqueCount: number;
    lanternUsecaseCount: number;
    activeAlertCount: number;
    weightedIssues: number;
  };
}

/**
 * Normalize a batch of raw telemetry entries into canonical form.
 *
 * Each entry is routed through normalizers in order:
 *   1. windows.ts — WinEventLog:* patterns
 *   2. syslog.ts — Network/syslog/device patterns
 *   3. cloud.ts — AWS/Azure/GCP/O365 patterns
 *   4. generic.ts — Everything else (never fails)
 *
 * Errors are accumulated but never thrown.
 */
export function normalizeBatch(entries: RawTelemetryEntry[]): NormalizationResult {
  const canonical: CanonicalTelemetry[] = [];
  const errors: NormalizationError[] = [];

  for (const entry of entries) {
    try {
      // Try Windows normalizer first
      const windows = normalizeWindows(
        entry.index, entry.sourcetype,
        entry.dailyAvgGb, entry.totalEvents, entry.retentionDays, entry.costPerGbPerDay,
        entry.precomputedScores
      );
      if (windows) {
        canonical.push(windows);
        continue;
      }

      // Try syslog/network normalizer
      const syslog = normalizeSyslog(
        entry.index, entry.sourcetype,
        entry.dailyAvgGb, entry.totalEvents, entry.retentionDays, entry.costPerGbPerDay,
        entry.precomputedScores
      );
      if (syslog) {
        canonical.push(syslog);
        continue;
      }

      // Try cloud normalizer
      const cloud = normalizeCloud(
        entry.index, entry.sourcetype,
        entry.dailyAvgGb, entry.totalEvents, entry.retentionDays, entry.costPerGbPerDay,
        entry.precomputedScores
      );
      if (cloud) {
        canonical.push(cloud);
        continue;
      }

      // Fallback to generic normalizer
      canonical.push(normalizeGeneric(
        entry.index, entry.sourcetype,
        entry.dailyAvgGb, entry.totalEvents, entry.retentionDays, entry.costPerGbPerDay,
        entry.precomputedScores
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({
        rawSourcetype: entry.sourcetype || '',
        rawIndex: entry.index,
        message: `Normalization failed: ${msg}`,
      });
      // Still produce a generic result — never drop data
      canonical.push(normalizeGeneric(
        entry.index, entry.sourcetype,
        entry.dailyAvgGb, entry.totalEvents, entry.retentionDays, entry.costPerGbPerDay,
        entry.precomputedScores
      ));
    }
  }

  return { canonical, errors };
}
