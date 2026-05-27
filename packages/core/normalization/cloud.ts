/**
 * CLOUD PLATFORM NORMALIZER
 *
 * Normalizes cloud platform sourcetypes (AWS, Azure, GCP, O365) into canonical entries.
 * Prevents double-counting when the same cloud event appears under multiple sourcetypes.
 *
 * Examples:
 *   aws:cloudtrail    → category=cloud, channel=audit
 *   o365:management   → category=cloud, channel=identity
 *   azure:audit       → category=cloud, channel=audit
 *   gcp:pubsub        → category=cloud, channel=pubsub
 */

import type { CanonicalTelemetry, CanonicalCategory, NormalizationConfidence } from './canonical';

interface CloudMapping {
  category: CanonicalCategory;
  canonical: string;
  channel: string;
}

const CLOUD_MAP: Record<string, CloudMapping> = {
  'aws:cloudtrail':       { category: 'cloud', canonical: 'aws_cloudtrail',      channel: 'audit' },
  'aws:config':           { category: 'cloud', canonical: 'aws_config',          channel: 'config' },
  'aws:guardduty':        { category: 'security', canonical: 'aws_guardduty',    channel: 'threat_detection' },
  'aws:vpc':              { category: 'network', canonical: 'aws_vpc',            channel: 'network' },
  'aws:s3':               { category: 'application', canonical: 'aws_s3',        channel: 'storage' },
  'aws:lambda':           { category: 'application', canonical: 'aws_lambda',     channel: 'serverless' },
  'aws:ec2':              { category: 'infra',    canonical: 'aws_ec2',           channel: 'compute' },
  'aws:rds':              { category: 'application', canonical: 'aws_rds',        channel: 'database' },
  'aws:elb':              { category: 'network', canonical: 'aws_elb',            channel: 'load_balancer' },
  'aws:waf':              { category: 'security', canonical: 'aws_waf',           channel: 'waf' },
  'azure:audit':          { category: 'cloud',    canonical: 'azure_audit',       channel: 'audit' },
  'azure:signin':         { category: 'cloud',    canonical: 'azure_signin',      channel: 'identity' },
  'azure:activity':       { category: 'cloud',    canonical: 'azure_activity',    channel: 'audit' },
  'azure:security':       { category: 'security', canonical: 'azure_security',    channel: 'threat_detection' },
  'azure:network':        { category: 'network',  canonical: 'azure_network',     channel: 'network' },
  'azure:storage':        { category: 'application', canonical: 'azure_storage',  channel: 'storage' },
  'azure:vm':             { category: 'infra',    canonical: 'azure_vm',          channel: 'compute' },
  'azure:sql':            { category: 'application', canonical: 'azure_sql',      channel: 'database' },
  'gcp:pubsub':           { category: 'application', canonical: 'gcp_pubsub',     channel: 'pubsub' },
  'gcp:audit':            { category: 'cloud',    canonical: 'gcp_audit',         channel: 'audit' },
  'gcp:vpc':              { category: 'network',  canonical: 'gcp_vpc',           channel: 'network' },
  'gcp:storage':          { category: 'application', canonical: 'gcp_storage',    channel: 'storage' },
  'gcp:compute':          { category: 'infra',    canonical: 'gcp_compute',       channel: 'compute' },
  'o365:management':      { category: 'cloud',    canonical: 'o365_management',   channel: 'identity' },
  'o365:audit':           { category: 'cloud',    canonical: 'o365_audit',        channel: 'audit' },
  'o365:exchange':        { category: 'application', canonical: 'o365_exchange',  channel: 'email' },
  'o365:sharepoint':      { category: 'application', canonical: 'o365_sharepoint', channel: 'collaboration' },
  'o365:teams':           { category: 'application', canonical: 'o365_teams',     channel: 'messaging' },
};

export function normalizeCloud(
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
): CanonicalTelemetry | null {
  if (!sourcetype) return null;

  const key = sourcetype.toLowerCase();
  const mapping = CLOUD_MAP[key];
  if (!mapping) return null;

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
