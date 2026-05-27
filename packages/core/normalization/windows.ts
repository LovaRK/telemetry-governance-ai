/**
 * WINDOWS EVENT LOG NORMALIZER
 *
 * Normalizes raw Windows Event Log sourcetypes into canonical entries.
 * Prevents double-counting by splitting WinEventLog channels correctly.
 *
 * Input:  WinEventLog:Security, WinEventLog:System, WinEventLog:Application
 * Output: category=endpoint, channel=security/system/application, canonical=windows_security
 *
 * Guard: security channel detection counts are not mixed with application channel.
 */

import type { CanonicalTelemetry, CanonicalCategory, NormalizationConfidence } from './canonical';

const WINDOWS_PATTERN = /^WinEventLog:(.+)$/i;

const CHANNEL_MAP: Record<string, { category: CanonicalCategory; canonical: string; channel: string }> = {
  security:    { category: 'security',   canonical: 'windows_security',    channel: 'security' },
  system:      { category: 'endpoint',   canonical: 'windows_system',     channel: 'system' },
  application: { category: 'application', canonical: 'windows_application', channel: 'application' },
  powershell:  { category: 'security',   canonical: 'windows_powershell',  channel: 'powershell' },
  sysmon:      { category: 'security',   canonical: 'windows_sysmon',     channel: 'sysmon' },
  'task scheduler': { category: 'infra', canonical: 'windows_task_scheduler', channel: 'infra' },
  dns:         { category: 'infra',      canonical: 'windows_dns',         channel: 'dns' },
  dhcp:        { category: 'infra',      canonical: 'windows_dhcp',        channel: 'dhcp' },
};

/**
 * Normalize a Windows Event Log sourcetype.
 * Returns null if the sourcetype does not match the Windows pattern.
 */
export function normalizeWindows(
  index: string,
  sourcetype: string | null | undefined,
  dailyAvgGb: number,
  totalEvents: number,
  retentionDays: number,
  costPerGbPerDay: number,
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
  }
): CanonicalTelemetry | null {
  if (!sourcetype) return null;
  const match = sourcetype.match(WINDOWS_PATTERN);
  if (!match) return null;

  const channel = match[1].toLowerCase();
  const mapping = CHANNEL_MAP[channel];

  // Unknown Windows channel → generic endpoint
  if (!mapping) {
    return {
      sourceType: `windows_${channel}`,
      category: 'endpoint',
      channel,
      events: totalEvents,
      volumeGb: dailyAvgGb,
      utilizationInputs: {
        index,
        sourcetype,
        alertCount: precomputedScores?.alertCount ?? 0,
        scheduledSearchCount: precomputedScores?.scheduledSearchCount ?? 0,
        dashboardPanelCount: precomputedScores?.dashboardPanelCount ?? 0,
        distinctUserCount: precomputedScores?.distinctUserCount ?? 0,
        adHocSearchCount: precomputedScores?.adHocSearchCount ?? 0,
      },
      detectionInputs: {
        index,
        sourcetype,
        mitreTechniqueCount: precomputedScores?.mitreTechniqueCount ?? 0,
        lanternUsecaseCount: precomputedScores?.lanternUsecaseCount ?? 0,
        activeAlertCount: precomputedScores?.activeAlertCount ?? 0,
      },
      qualityInputs: {
        index,
        sourcetype,
        weightedIssues: precomputedScores?.weightedIssues ?? 0,
        dailyGb: dailyAvgGb,
      },
      raw: { index, sourcetype, dailyAvgGb, totalEvents, retentionDays },
      confidence: 'LOW',
    };
  }

  return {
    sourceType: mapping.canonical,
    category: mapping.category,
    channel: mapping.channel,
    events: totalEvents,
    volumeGb: dailyAvgGb,
    utilizationInputs: {
      index,
      sourcetype,
      alertCount: precomputedScores?.alertCount ?? 0,
      scheduledSearchCount: precomputedScores?.scheduledSearchCount ?? 0,
      dashboardPanelCount: precomputedScores?.dashboardPanelCount ?? 0,
      distinctUserCount: precomputedScores?.distinctUserCount ?? 0,
      adHocSearchCount: precomputedScores?.adHocSearchCount ?? 0,
    },
    detectionInputs: {
      index,
      sourcetype,
      mitreTechniqueCount: precomputedScores?.mitreTechniqueCount ?? 0,
      lanternUsecaseCount: precomputedScores?.lanternUsecaseCount ?? 0,
      activeAlertCount: precomputedScores?.activeAlertCount ?? 0,
    },
    qualityInputs: {
      index,
      sourcetype,
      weightedIssues: precomputedScores?.weightedIssues ?? 0,
      dailyGb: dailyAvgGb,
    },
    raw: { index, sourcetype, dailyAvgGb, totalEvents, retentionDays },
    confidence: 'HIGH',
  };
}
