/**
 * Splunk Queries Service
 *
 * Pulls rich metadata from Splunk REST API needed for deterministic scoring:
 *   - Saved searches / alerts / dashboard panels per sourcetype (→ Utilization)
 *   - MITRE ATT&CK and Lantern use case mappings (→ Detection)
 *   - Data quality / parsing issues (→ Quality)
 *   - Field usage data (→ Storage savings)
 *
 * All queries use the Splunk management REST API (port 8089).
 * Results are normalized into the shapes consumed by deterministic-scoring-engine.ts.
 */

import { SplunkDataSource } from './splunk-client';
import type { UtilizationInputs, DetectionInputs, QualityInputs } from './deterministic-scoring-engine';
import { auditSplQuery } from './parser-confidence-service';

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

// ─── Saved Search / Knowledge Object Inventory ───────────────────────────────

export interface KnowledgeObjectCounts {
  /** index:sourcetype key e.g. "main::syslog" or "main::_" for index-level */
  key: string;
  index: string;
  sourcetype: string | null;
  alertCount: number;
  scheduledSearchCount: number;
  dashboardPanelCount: number;
  adHocSearchCount: number;
  distinctUserCount: number;
}

/**
 * Pull saved searches + alerts from Splunk REST API.
 * Endpoint: GET /services/saved/searches?count=0&output_mode=json
 *
 * Groups by index/sourcetype extracted from search SPL.
 * Falls back gracefully to empty array if Splunk doesn't support query.
 */
export async function querySavedSearchInventory(
  splunk: SplunkDataSource,
  indexNames: string[]
): Promise<KnowledgeObjectCounts[]> {
  try {
    const raw = await splunk.restGet(
      '/services/saved/searches?count=0&output_mode=json&search=disabled%3Dfalse'
    );
    if (!raw?.entry) return buildFallback(indexNames);

    // Count by index using 1/N attribution weighting.
    // When a search references N tracked indexes, each gets 1/N fractional credit
    // to avoid score inflation for broad wildcard searches (e.g. index=* or index=main OR index=security).
    const countsByIndex = new Map<string, KnowledgeObjectCounts>();

    const indexNamesSet = new Set(indexNames.map(n => n.toLowerCase()));

    for (const entry of raw.entry) {
      const content     = entry.content || {};
      const searchStr   = content.search || '';
      const isAlert     = content.alert_type && content.alert_type !== 'always';
      const isScheduled = content['is_scheduled'] === '1' || content.cron_schedule;

      // Extract ALL index references from SPL (deduplicated)
      const allIndexMatches: string[] = [...new Set<string>(
        (searchStr.match(/index\s*=\s*(\w+)/gi) || [])
          .map((m: string) => m.replace(/index\s*=\s*/i, '').toLowerCase())
      )];

      // Keep only tracked indexes
      const matchedTracked = allIndexMatches.filter(idx => indexNamesSet.has(idx));
      if (matchedTracked.length === 0) continue;

      // Attribution factor: 1/N where N = number of tracked indexes this search covers
      const attributionFactor = 1 / matchedTracked.length;

      for (const idx of matchedTracked) {
        const key = `${idx}::_`;
        if (!countsByIndex.has(key)) {
          countsByIndex.set(key, {
            key, index: idx, sourcetype: null,
            alertCount: 0, scheduledSearchCount: 0,
            dashboardPanelCount: 0, adHocSearchCount: 0, distinctUserCount: 0,
          });
        }
        const rec = countsByIndex.get(key)!;
        if (isAlert)          rec.alertCount          += attributionFactor;
        else if (isScheduled) rec.scheduledSearchCount += attributionFactor;
        // Note: fractional counts are kept as floats; the scoring engine handles them fine.
      }
    }

    // ── Dashboard panel counts via /services/data/ui/views ───────────────────
    // Each dashboard view XML is scanned for `index=<name>` references.
    // Attribution weighting (1/N) applied the same way as saved searches.
    try {
      const dashRaw = await splunk.restGet(
        '/services/data/ui/views?count=0&output_mode=json&digest=1'
      );
      if (dashRaw?.entry) {
        for (const entry of dashRaw.entry) {
          const xml: string = entry.content?.['eai:data'] || '';
          if (!xml) continue;

          const allIndexMatches = [...new Set(
            (xml.match(/index\s*=\s*"?(\w+)"?/gi) || [])
              .map((m: string) => m.replace(/index\s*=\s*"?/i, '').replace(/"$/, '').toLowerCase())
          )];
          const matchedTracked = allIndexMatches.filter(idx => indexNamesSet.has(idx));
          if (matchedTracked.length === 0) continue;

          const attributionFactor = 1 / matchedTracked.length;
          for (const idx of matchedTracked) {
            const key = `${idx}::_`;
            if (!countsByIndex.has(key)) {
              countsByIndex.set(key, {
                key, index: idx, sourcetype: null,
                alertCount: 0, scheduledSearchCount: 0,
                dashboardPanelCount: 0, adHocSearchCount: 0, distinctUserCount: 0,
              });
            }
            countsByIndex.get(key)!.dashboardPanelCount += attributionFactor;
          }
        }
      }
    } catch (dashErr) {
      console.warn('[KnowledgeObjects] Dashboard panel query failed (non-critical):', (dashErr as Error).message);
    }

    return countsByIndex.size > 0
      ? Array.from(countsByIndex.values())
      : buildFallback(indexNames);

  } catch (e) {
    console.warn('[KnowledgeObjects] Splunk REST query failed, using fallback zeros:', (e as Error).message);
    return buildFallback(indexNames);
  }
}

// ─── Parsing Error Signals (Quality Scoring) ─────────────────────────────────

/**
 * Query Splunk _internal index for parsing / dataparsing errors.
 *
 * These are the primary input for Quality Score:
 *   quality(st) = max(0, 100 − (issue_density × 2000))
 *   issue_density = weighted_issues / (daily_gb × 1M events)
 *
 * DateParserVerbose errors are weighted × 0.5 (minor impact).
 * All other parsing errors (WARN_HEADER, TRANSFORMS_LOOKUP, etc.) are × 1.0.
 *
 * Returns a Map keyed by "index::sourcetype" with the weighted issue count.
 * Falls back to an empty Map if _internal is not accessible.
 */
export async function queryParsingErrors(
  splunk: SplunkDataSource,
  lookbackDays: number = 7,
  tenantId?: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  // MIGRATION NOTE: Previously used raw `search index=_internal` which collapses
  // at enterprise scale (O(N) full scan). Now uses tstats with summariesonly=true
  // to leverage accelerated data model summaries.
  //
  // tstats approach: pull component-level counts from the _internal data model.
  // Falls back to raw SPL only if tstats returns zero results (data model not built yet).
  //
  // Anti-pattern eliminated:
  //   BEFORE: search index=_internal sourcetype=splunkd ... (unbounded raw scan)
  //   AFTER:  tstats summariesonly=true ... (data model accelerated)

  // Primary: tstats against the InternalLogs data model (available in Splunk 8.0+)
  const tsstatsSpl = `| tstats summariesonly=true
    count AS event_count
    WHERE index=_internal
      sourcetype=splunkd
      (component=DateParserVerbose OR component=DateParser OR component=LineBreaker OR component=TRANSFORMS)
      earliest=-${lookbackDays}d
      latest=now
    BY index, sourcetype, component
  | eval weight=if(component="DateParserVerbose", 0.5, 1.0)
  | eval weighted_issues=event_count*weight
  | stats sum(weighted_issues) AS weighted_issues BY index, sourcetype
  | rename index AS idx, sourcetype AS st
  | where isnotnull(idx) AND isnotnull(st)
  | head 1000`;

  // Fallback: raw SPL with explicit time bounds and head circuit breaker
  // Used when tstats returns empty (data model not yet accelerated)
  const fallbackSpl = `search index=_internal sourcetype=splunkd
    (component=DateParserVerbose OR component=DateParser OR component=LineBreaker OR component=TRANSFORMS)
    log_level=WARN
    earliest=-${lookbackDays}d
    latest=now
  | rex field=message "for sourcetype='(?<st>[^']+)'"
  | rex field=message "in source='[^']*index=(?<idx>[^'\\s]+)'"
  | eval weight=if(component="DateParserVerbose", 0.5, 1.0)
  | stats sum(weight) AS weighted_issues by idx, st
  | where isnotnull(idx) AND isnotnull(st)
  | head 1000`;

  const tryQuery = async (spl: string, label: string): Promise<boolean> => {
    try {
      const rows: Array<{ idx: string; st: string; weighted_issues: string }> =
        await splunk.runSearch(spl, { earliestTime: `-${lookbackDays}d`, latestTime: 'now' });

      if (Array.isArray(rows) && rows.length > 0) {
        for (const row of rows) {
          const key = `${row.idx}::${row.st}`;
          result.set(key, parseFloat(row.weighted_issues) || 0);
        }
        console.log(`[ParsingErrors:${label}] Found ${result.size} sourcetypes with parsing issues (lookback=${lookbackDays}d)`);
        return true;
      }
      return false;
    } catch (e) {
      console.warn(`[ParsingErrors:${label}] Query failed:`, (e as Error).message);
      return false;
    }
  };

  // Try tstats first; fall back to raw SPL if needed
  const tsstatsSuccess = await tryQuery(tsstatsSpl, 'tstats');
  const activeSpl = tsstatsSuccess ? tsstatsSpl : fallbackSpl;
  if (!tsstatsSuccess) {
    await tryQuery(fallbackSpl, 'raw_fallback');
    if (result.size === 0) {
      console.warn('[ParsingErrors] Both tstats and raw SPL returned no results — quality scores default to 100');
    }
  }

  // ── Phase 9: Emit parser confidence audit record (fire-and-forget) ──
  if (tenantId) {
    void auditSplQuery(tenantId, activeSpl, {
      indexName: '_internal',
    }).catch(err => console.warn('[queryParsingErrors] Parser confidence audit failed:', err));
  }

  return result;
}

// ─── Ad-hoc Usage Signals (_audit) ───────────────────────────────────────────

export interface AdhocUsage {
  adHocSearchCount: number;
  distinctUserCount: number;
}

/**
 * Query _audit for completed ad-hoc searches (last `lookbackDays`).
 *
 * Utilization formula includes adhoc×1 + users×2 — without these signals our
 * scores diverge from Data Sensei, which reads the same audit trail.
 *
 * - savedsearch_name="" filters to ad-hoc only (scheduled runs carry a name)
 * - searches starting with '|' (tstats/metadata/eventcount — including this
 *   agent's own refresh queries) are excluded as non-human noise
 * - index refs extracted with the same literal-index regex + 1/N attribution
 *   used for knowledge objects
 *
 * Returns Map<indexName, AdhocUsage>; empty Map when _audit is inaccessible.
 */
export async function queryAdhocUsage(
  splunk: SplunkDataSource,
  indexNames: string[],
  lookbackDays: number = 7,
): Promise<Map<string, AdhocUsage>> {
  const result = new Map<string, AdhocUsage>();
  const indexNamesSet = new Set(indexNames.map(n => n.toLowerCase()));

  const spl = `search index=_audit action=search info=completed savedsearch_name=""
    earliest=-${lookbackDays}d latest=now
  | where isnotnull(search) AND search!=""
  | table user, search
  | head 5000`;

  try {
    const rows: Array<{ user: string; search: string }> =
      await splunk.runSearch(spl, { earliestTime: `-${lookbackDays}d`, latestTime: 'now' });

    const usersByIndex = new Map<string, Set<string>>();

    for (const row of rows) {
      const raw = (row.search || '').trim().replace(/^'/, '');
      if (!raw || raw.startsWith('|')) continue; // generating commands = machine noise

      const refs = [...new Set(
        (raw.match(/index\s*=\s*"?([\w-]+)"?/gi) || [])
          .map(m => m.replace(/index\s*=\s*"?/i, '').replace(/"$/, '').toLowerCase())
      )].filter(idx => indexNamesSet.has(idx));
      if (refs.length === 0) continue;

      const w = 1 / refs.length;
      const user = (row.user || 'unknown').trim();
      for (const idx of refs) {
        const cur = result.get(idx) || { adHocSearchCount: 0, distinctUserCount: 0 };
        cur.adHocSearchCount += w;
        result.set(idx, cur);
        if (!usersByIndex.has(idx)) usersByIndex.set(idx, new Set());
        usersByIndex.get(idx)!.add(user);
      }
    }

    for (const [idx, users] of usersByIndex) {
      result.get(idx)!.distinctUserCount = users.size;
    }

    if (result.size > 0) {
      console.log(`[AdhocUsage] ${result.size} indexes with ad-hoc activity (lookback=${lookbackDays}d)`);
    }
  } catch (e) {
    console.warn('[AdhocUsage] _audit query failed, adhoc/user counts default to 0:', (e as Error).message);
  }

  return result;
}

function buildFallback(indexNames: string[]): KnowledgeObjectCounts[] {
  return indexNames.map(idx => ({
    key: `${idx}::_`,
    index: idx,
    sourcetype: null,
    alertCount: 0,
    scheduledSearchCount: 0,
    dashboardPanelCount: 0,
    adHocSearchCount: 0,
    distinctUserCount: 0,
  }));
}

// ─── MITRE ATT&CK Mapping ─────────────────────────────────────────────────────

/**
 * Built-in MITRE ATT&CK technique counts per common sourcetype.
 * Sourced from Splunk Lantern and ATT&CK Navigator mappings.
 * Used when the customer hasn't deployed the full TA.
 */
const MITRE_BASELINE: Record<string, number> = {
  // Windows / Endpoint
  'wineventlog':              65,
  'xmlwineventlog':           65,
  'wineventlog:security':     65,
  'xmlwineventlog:security':  65,
  'wineventlog:system':       30,
  'sysmon':                   80,
  'crowdstrike':              60,
  'carbonblack':              55,
  'sentinelone':              55,
  'cybereason':               50,
  // Network
  'network:firewall_traffic': 10,
  'cisco:asa':                12,
  'palo alto networks':       18,
  'pan:traffic':              18,
  'pan:threat':               25,
  'fortinet':                 12,
  'network:dns':              20,
  'stream:dns':               20,
  'zeek_dns':                 20,
  'zeek_conn':                8,
  // Identity / IAM
  'okta':                     30,
  'azure:aad:audit':          35,
  'azure:aad:signin':         40,
  'gsuite':                   20,
  'onelogin':                 25,
  // Cloud
  'aws:cloudtrail':           45,
  'aws:s3':                   5,
  'aws:guardduty':            35,
  'azure:activity':           30,
  'gcp:audit':                28,
  // Email
  'o365:management:activity': 20,
  'exchange':                 15,
  'proofpoint':               10,
  // Vulnerability / ITSM
  'tenable':                  5,
  'qualys':                   5,
  'servicenow':               0,
  'jira':                     0,
  // Low-value / generic
  'linux:syslog':             8,
  'syslog':                   8,
  'apache:access':            5,
  'iis':                      5,
  'nginx:plus:access':        5,
  'main':                     2,
  'history':                  0,
  'tutorial':                 0,
  '_internal':                0,
  '_audit':                   5,
  'splunk_web_access':        0,
};

/**
 * Built-in Lantern use case counts per common sourcetype.
 * Covers 12 Splunk Lantern domains: security, cloud, network, application,
 * infrastructure, platform, business, ITSM, OT, IoT, customer experience, fraud.
 */
const LANTERN_BASELINE: Record<string, number> = {
  'wineventlog':              8,
  'xmlwineventlog':           8,
  'wineventlog:security':     10,
  'sysmon':                   12,
  'crowdstrike':              8,
  'network:firewall_traffic': 5,
  'cisco:asa':                5,
  'pan:traffic':              6,
  'pan:threat':               8,
  'network:dns':              6,
  'stream:dns':               6,
  'okta':                     6,
  'azure:aad:signin':         7,
  'aws:cloudtrail':           8,
  'aws:guardduty':            6,
  'o365:management:activity': 5,
  'linux:syslog':             3,
  'syslog':                   3,
  'apache:access':            2,
  'servicenow':               4,
  'jira':                     2,
  'main':                     0,
  'history':                  0,
  'tutorial':                 0,
  '_internal':                0,
  'splunk_web_access':        0,
};

function lookupMitre(index: string, sourcetype: string | null): number {
  const key = (sourcetype || index).toLowerCase().trim();
  // Exact match first
  if (MITRE_BASELINE[key] !== undefined) return MITRE_BASELINE[key];
  // Prefix match
  for (const [pattern, count] of Object.entries(MITRE_BASELINE)) {
    if (key.startsWith(pattern) || pattern.startsWith(key)) return count;
  }
  return 0;
}

function lookupLantern(index: string, sourcetype: string | null): number {
  const key = (sourcetype || index).toLowerCase().trim();
  if (LANTERN_BASELINE[key] !== undefined) return LANTERN_BASELINE[key];
  for (const [pattern, count] of Object.entries(LANTERN_BASELINE)) {
    if (key.startsWith(pattern) || pattern.startsWith(key)) return count;
  }
  return 0;
}

// ─── Public API: build scoring inputs from index metadata ────────────────────

export interface RawIndexMeta {
  index: string;
  sourcetype: string | null;
  dailyAvgGb: number;
  totalEvents: number;
  retentionDays: number;
}

/**
 * Build UtilizationInputs from saved search inventory.
 * If inventory is unavailable, all counts default to 0
 * (LLM will fill in reasoning context).
 */
export function buildUtilizationInputs(
  indexMeta: RawIndexMeta[],
  koInventory: KnowledgeObjectCounts[]
): UtilizationInputs[] {
  const koMap = new Map(koInventory.map(k => [k.index, k]));

  return indexMeta.map(meta => {
    const ko = koMap.get(meta.index);
    return {
      index:               meta.index,
      sourcetype:          meta.sourcetype,
      alertCount:          ko?.alertCount           ?? 0,
      scheduledSearchCount: ko?.scheduledSearchCount ?? 0,
      dashboardPanelCount: ko?.dashboardPanelCount  ?? 0,
      distinctUserCount:   ko?.distinctUserCount     ?? 0,
      adHocSearchCount:    ko?.adHocSearchCount      ?? 0,
    };
  });
}

/**
 * Build DetectionInputs using MITRE + Lantern baseline lookups.
 * Alert counts sourced from KO inventory.
 */
export function buildDetectionInputs(
  indexMeta: RawIndexMeta[],
  koInventory: KnowledgeObjectCounts[]
): DetectionInputs[] {
  const koMap = new Map(koInventory.map(k => [k.index, k]));

  return indexMeta.map(meta => ({
    index:              meta.index,
    sourcetype:         meta.sourcetype,
    mitreTechniqueCount: lookupMitre(meta.index, meta.sourcetype),
    lanternUsecaseCount: lookupLantern(meta.index, meta.sourcetype),
    activeAlertCount:   koMap.get(meta.index)?.alertCount ?? 0,
  }));
}

/**
 * Build QualityInputs.
 * Without the TA CSV, parsing issues default to 0 → quality = 100
 * (PDF edge case: missing from quality CSV → default 100).
 */
export function buildQualityInputs(
  indexMeta: RawIndexMeta[],
  qualityData: Map<string, number> = new Map()
): QualityInputs[] {
  return indexMeta.map(meta => {
    const key = meta.sourcetype
      ? `${meta.index}::${meta.sourcetype}`
      : meta.index;
    return {
      index:          meta.index,
      sourcetype:     meta.sourcetype,
      weightedIssues: qualityData.get(key) ?? 0,  // defaults to 0 → quality = 100
      dailyGb:        meta.dailyAvgGb,
    };
  });
}

// ─── Legacy stubs (preserved for backward compatibility) ─────────────────────

export async function queryFieldUsage(
  splunk: SplunkDataSource,
  lookbackDays: number = 30
): Promise<FieldUsageResult[]> {
  console.warn('[FieldUsage] Not yet implemented — requires TA CSV');
  return [];
}

export async function querySecurityCoverage(
  splunk: SplunkDataSource,
  lookbackDays: number = 30
): Promise<SecurityCoverageResult[]> {
  console.warn('[SecurityCoverage] Using MITRE baseline lookup table');
  return [];
}

export async function queryDataQualityMetrics(
  splunk: SplunkDataSource,
  lookbackDays: number = 30
): Promise<QualityHotspotResult[]> {
  console.warn('[QualityHotspots] Not yet implemented — requires TA CSV');
  return [];
}
