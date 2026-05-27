/**
 * SYSLOG / NETWORK DEVICE NORMALIZER
 *
 * Normalizes syslog-based network device sourcetypes into canonical entries.
 *
 * Examples:
 *   cisco:asa        → category=network, channel=firewall
 *   fortigate        → category=network, channel=firewall
 *   pan:traffic      → category=network, channel=firewall
 *   pan:threat       → category=security, channel=ids
 *   linux_secure     → category=infra, channel=auth
 *   syslog           → category=generic, channel=syslog
 */

import type { CanonicalTelemetry, CanonicalCategory, NormalizationConfidence } from './canonical';

interface SyslogMapping {
  category: CanonicalCategory;
  canonical: string;
  channel: string;
}

const SYSMAP: Record<string, SyslogMapping> = {
  'cisco:asa':        { category: 'network', canonical: 'cisco_asa',        channel: 'firewall' },
  'cisco:ios':        { category: 'network', canonical: 'cisco_ios',        channel: 'router' },
  'cisco:nexus':      { category: 'network', canonical: 'cisco_nexus',      channel: 'switch' },
  'cisco:wireless':   { category: 'network', canonical: 'cisco_wireless',   channel: 'wireless' },
  'fortigate':        { category: 'network', canonical: 'fortigate',        channel: 'firewall' },
  'fortinet':         { category: 'network', canonical: 'fortinet',         channel: 'firewall' },
  'pan:traffic':      { category: 'network', canonical: 'pan_traffic',      channel: 'firewall' },
  'pan:threat':       { category: 'security', canonical: 'pan_threat',      channel: 'ids' },
  'pan:system':       { category: 'infra',    canonical: 'pan_system',      channel: 'infra' },
  'paloalto:traffic': { category: 'network',  canonical: 'paloalto_traffic', channel: 'firewall' },
  'paloalto:threat':  { category: 'security', canonical: 'paloalto_threat',  channel: 'ids' },
  'checkpoint':       { category: 'network',  canonical: 'checkpoint',       channel: 'firewall' },
  'sonicwall':        { category: 'network',  canonical: 'sonicwall',        channel: 'firewall' },
  'juniper:fw':       { category: 'network',  canonical: 'juniper_fw',       channel: 'firewall' },
  'juniper:idp':      { category: 'security', canonical: 'juniper_idp',      channel: 'ids' },
  'linux_secure':     { category: 'infra',    canonical: 'linux_secure',     channel: 'auth' },
  'linux_auth':       { category: 'infra',    canonical: 'linux_auth',       channel: 'auth' },
  'linux_messages':   { category: 'infra',    canonical: 'linux_messages',   channel: 'system' },
  'linux_syslog':     { category: 'infra',    canonical: 'linux_syslog',     channel: 'system' },
  'authlog':          { category: 'infra',    canonical: 'authlog',          channel: 'auth' },
  'secure':           { category: 'infra',    canonical: 'secure',           channel: 'auth' },
  'messages':         { category: 'infra',    canonical: 'messages',         channel: 'system' },
  'syslog':           { category: 'generic',  canonical: 'syslog',           channel: 'syslog' },
};

/** Prefix-based fallback map: if sourcetype starts with key, use this mapping */
const PREFIX_MAP: Array<{ prefix: string; mapping: SyslogMapping }> = [
  { prefix: 'cisco:',    mapping: { category: 'network', canonical: 'cisco_generic', channel: 'network' } },
  { prefix: 'pan:',      mapping: { category: 'network', canonical: 'pan_generic',   channel: 'firewall' } },
  { prefix: 'paloalto:', mapping: { category: 'network', canonical: 'paloalto_generic', channel: 'firewall' } },
  { prefix: 'juniper:',  mapping: { category: 'network', canonical: 'juniper_generic', channel: 'network' } },
  { prefix: 'linux_',    mapping: { category: 'infra',   canonical: 'linux_generic',   channel: 'system' } },
  { prefix: 'ssh',       mapping: { category: 'infra',   canonical: 'ssh',             channel: 'auth' } },
  { prefix: 'sudo',      mapping: { category: 'infra',   canonical: 'sudo',            channel: 'auth' } },
  { prefix: 'dhcpd',     mapping: { category: 'infra',   canonical: 'dhcpd',           channel: 'dhcp' } },
  { prefix: 'named',     mapping: { category: 'infra',   canonical: 'named',           channel: 'dns' } },
  { prefix: 'dns',       mapping: { category: 'infra',   canonical: 'dns',             channel: 'dns' } },
  { prefix: 'ntp',       mapping: { category: 'infra',   canonical: 'ntp',             channel: 'ntp' } },
  { prefix: 'httpd',     mapping: { category: 'application', canonical: 'httpd',       channel: 'web' } },
  { prefix: 'apache',    mapping: { category: 'application', canonical: 'apache',      channel: 'web' } },
  { prefix: 'nginx',     mapping: { category: 'application', canonical: 'nginx',       channel: 'web' } },
  { prefix: 'iis',       mapping: { category: 'application', canonical: 'iis',         channel: 'web' } },
  { prefix: 'mysql',     mapping: { category: 'application', canonical: 'mysql',       channel: 'database' } },
  { prefix: 'postgres',  mapping: { category: 'application', canonical: 'postgres',    channel: 'database' } },
  { prefix: 'mongo',     mapping: { category: 'application', canonical: 'mongodb',     channel: 'database' } },
  { prefix: 'redis',     mapping: { category: 'application', canonical: 'redis',       channel: 'cache' } },
];

export function normalizeSyslog(
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

  const key = sourcetype.toLowerCase();

  // Exact match first
  const exact = SYSMAP[key];
  if (exact) {
    return buildCanonical(exact, index, sourcetype, dailyAvgGb, totalEvents, retentionDays, precomputedScores, 'HIGH');
  }

  // Prefix match
  for (const { prefix, mapping } of PREFIX_MAP) {
    if (key.startsWith(prefix)) {
      return buildCanonical(mapping, index, sourcetype, dailyAvgGb, totalEvents, retentionDays, precomputedScores, 'MEDIUM');
    }
  }

  return null;
}

function buildCanonical(
  mapping: SyslogMapping,
  index: string,
  sourcetype: string,
  dailyAvgGb: number,
  totalEvents: number,
  retentionDays: number,
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
  },
  confidence: NormalizationConfidence = 'MEDIUM'
): CanonicalTelemetry {
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
    confidence,
  };
}

export type { SyslogMapping, NormalizationConfidence };
