/**
 * GENERIC FALLBACK NORMALIZER
 *
 * Never crashes. Never returns null.
 * Every unrecognized sourcetype gets a generic canonical entry.
 *
 * This prevents ingestion deadlocks when new sourcetypes appear.
 * The raw payload is preserved — confidence is always LOW for audit.
 */

import type { CanonicalTelemetry, NormalizationConfidence } from './canonical';

/**
 * Normalize any unrecognized sourcetype into a generic canonical entry.
 * This is the final fallback — never throws, never returns null.
 */
export function normalizeGeneric(
  index: string,
  sourcetype: string | null | undefined,
  dailyAvgGb: number,
  totalEvents: number,
  retentionDays: number,
  costPerGbPerDay: number,
  precomputedScores?: {
    utilizationScore?: number;
    detectionScore?: number;
    qualityScore?: number;
    compositeScore?: number;
    tier?: string;
    detectionGap?: boolean;
    operationalGap?: boolean;
    alertCount?: number;
    scheduledSearchCount?: number;
    dashboardPanelCount?: number;
    distinctUserCount?: number;
    adHocSearchCount?: number;
    mitreTechniqueCount?: number;
    lanternUsecaseCount?: number;
    activeAlertCount?: number;
    weightedIssues?: number;
  }
): CanonicalTelemetry {
  const safeSourcetype = sourcetype || `${index}_unknown`;
  const safeKey = safeSourcetype
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    || 'unknown';

  // Infer a plausible category from key characteristics
  let category: CanonicalTelemetry['category'] = 'generic';
  if (/kube|container|docker|pod/i.test(safeSourcetype)) category = 'infra';
  else if (/custom|app|service|api/i.test(safeSourcetype)) category = 'application';
  else if (/sensor|iot|edge/i.test(safeSourcetype)) category = 'infra';
  else if (/db|database|sql/i.test(safeSourcetype)) category = 'application';
  else if (/firewall|vpn|proxy|gateway/i.test(safeSourcetype)) category = 'network';
  else if (/audit|compliance/i.test(safeSourcetype)) category = 'security';

  return {
    sourceType: `generic_${safeKey}`,
    category,
    channel: safeKey,
    events: totalEvents,
    volumeGb: dailyAvgGb,
    utilizationInputs: {
      index,
      sourcetype: safeSourcetype,
      alertCount: precomputedScores?.alertCount ?? 0,
      scheduledSearchCount: precomputedScores?.scheduledSearchCount ?? 0,
      dashboardPanelCount: precomputedScores?.dashboardPanelCount ?? 0,
      distinctUserCount: precomputedScores?.distinctUserCount ?? 0,
      adHocSearchCount: precomputedScores?.adHocSearchCount ?? 0,
    },
    detectionInputs: {
      index,
      sourcetype: safeSourcetype,
      mitreTechniqueCount: precomputedScores?.mitreTechniqueCount ?? 0,
      lanternUsecaseCount: precomputedScores?.lanternUsecaseCount ?? 0,
      activeAlertCount: precomputedScores?.activeAlertCount ?? 0,
    },
    qualityInputs: {
      index,
      sourcetype: safeSourcetype,
      weightedIssues: precomputedScores?.weightedIssues ?? 0,
      dailyGb: dailyAvgGb,
    },
    raw: { index, sourcetype: safeSourcetype, dailyAvgGb, totalEvents, retentionDays },
    confidence: 'LOW',
  };
}
