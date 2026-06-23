/**
 * 01 — Parse the 1stMile lookup CSVs into manifest.json
 *
 * The manifest is the single source of truth for every later env-prep step:
 *   indexes → sourcetypes → daily-GB proportions, knowledge-object counts per
 *   index (1/N attribution like the scoring engine), ad-hoc usage distribution,
 *   quality-issue injection targets, macros/eventtypes/tags, expected counts.
 *
 * Usage: node scripts/env-prep/01-parse-csvs.mjs
 */

import { readSeedCsv, saveManifest, log } from './00-lib.mjs';

const SECURITY_KEYWORDS = /alert|detect|threat|attack|suspicious|malicious|brute|lateral|privilege|anomal|compromise|exploit|exfiltrat|intrusion|incident|forensic|investigat|impossible|improbable|logon|account|audit|denied|banned|blocked/i;

// Caps keep Splunk KO creation tractable while preserving proportions.
const MAX_SAVED_SEARCHES_PER_INDEX = 25;
const MAX_DASHBOARDS_PER_INDEX = 10;
const MAX_MACROS = 100;

function extractIndexRefs(spl, trackedSet) {
  const refs = [...new Set(
    (spl.match(/index\s*=\s*"?([\w-]+)"?/gi) || [])
      .map(m => m.replace(/index\s*=\s*"?/i, '').replace(/"$/, '').toLowerCase())
  )];
  return refs.filter(r => trackedSet.has(r));
}

function main() {
  // Teja confirmed 1stmile daily ingest is ~92 GB (Slack, June 2026).
  // CSV is a 2-day export (Oct 26-27 2025); raw total ≈159.93 GB → ~80 GB/day avg.
  // Gap vs 92 GB: higher-volume days + sources not in this snapshot. Use 92 as authoritative.
  const LOGICAL_DAILY_INGEST_GB = 92;
  const PHYSICAL_INJECTION_GB = 0.25;

  // ── Volume: index → sourcetype → GB ────────────────────────────────────────
  const volumeRows = readSeedCsv('1stmile_index_sourcetype_and_source_volume_lookupcsv.csv');
  const volume = new Map(); // index → Map(sourcetype → {gb, source})
  let totalGb = 0;
  const csvDates = new Set();
  for (const r of volumeRows) {
    const index = (r.index || '').trim();
    const st = (r.sourcetype || '').trim();
    const gb = parseFloat(r.GB_idx_st_s || '0');
    if (!index || !st || !Number.isFinite(gb) || gb <= 0) continue;
    if (!volume.has(index)) volume.set(index, new Map());
    const stMap = volume.get(index);
    const cur = stMap.get(st) || { gb: 0, source: r.source || `/var/log/${st}.log` };
    cur.gb += gb;
    stMap.set(st, cur);
    totalGb += gb;
    const t = (r._time || '').substring(0, 10);
    if (t) csvDates.add(t);
  }
  const csvDateCount = csvDates.size || 1;
  const csvDailyAvgGb = parseFloat((totalGb / csvDateCount).toFixed(2));
  const trackedIndexes = [...volume.keys()];
  const trackedSet = new Set(trackedIndexes.map(i => i.toLowerCase()));
  log(`Volume: ${trackedIndexes.length} indexes, ${[...volume.values()].reduce((n, m) => n + m.size, 0)} index::sourcetype pairs`);
  log(`  CSV total: ${totalGb.toFixed(1)} GB across ${csvDateCount} date(s) → raw avg ${csvDailyAvgGb} GB/day`);
  log(`  Logical baseline: ${LOGICAL_DAILY_INGEST_GB} GB/day (Teja-confirmed) → scaleFactor ${(LOGICAL_DAILY_INGEST_GB / totalGb).toFixed(4)}`);

  // ── Index metadata: retention ──────────────────────────────────────────────
  const metaRows = readSeedCsv('1stmile_index_metadata_lookupcsv.csv');
  const retention = new Map();
  for (const r of metaRows) {
    const idx = (r.index || '').trim();
    const frozen = parseInt(r.frozenTimePeriodInSecs || '0', 10);
    if (idx && frozen > 0) retention.set(idx, frozen);
  }

  // ── Macros: title → definition (only those resolving to tracked indexes) ──
  const macroRows = readSeedCsv('1stmile_macros_inventory_lookup.csv');
  const macroDefs = new Map(); // title → definition
  for (const r of macroRows) {
    if (r.title && r.definition) macroDefs.set(r.title.trim(), r.definition.trim());
  }
  const usefulMacros = [...macroDefs.entries()]
    .filter(([, def]) => extractIndexRefs(def, trackedSet).length > 0)
    .slice(0, MAX_MACROS)
    .map(([title, definition]) => ({ title, definition }));

  /** Expand `macro` references one level so index= refs become visible. */
  function expandMacros(spl) {
    return spl.replace(/`([\w-]+)(?:\([^)]*\))?`/g, (m, name) => macroDefs.get(name) || m);
  }

  // ── Saved searches + dashboards inventory ─────────────────────────────────
  const invRows = readSeedCsv('1stmile_dashboard_savedsearches_inventory_lookup.csv');
  const koByIndex = new Map(); // index → counts + sample names
  const ensureKo = (idx) => {
    if (!koByIndex.has(idx)) {
      koByIndex.set(idx, {
        alertCount: 0, scheduledSearchCount: 0, dashboardPanelCount: 0,
        savedSearchSamples: [], dashboardSamples: new Map(),
      });
    }
    return koByIndex.get(idx);
  };

  let invScanned = 0, invAttributed = 0;
  for (const r of invRows) {
    const spl = expandMacros(r.search || '');
    const refs = extractIndexRefs(spl, trackedSet);
    invScanned++;
    if (refs.length === 0) continue;
    invAttributed++;
    const w = 1 / refs.length;

    const isDashboard = (r.search_type || '').trim() === 'dashboard' || !!(r.dashboard_name || '').trim();
    const isDisabled = r.disabled === '1' || r.disabled === 'true';
    if (isDisabled) continue;

    for (const idx of refs) {
      const ko = ensureKo(idx);
      if (isDashboard) {
        ko.dashboardPanelCount += w;
        const dash = (r.dashboard_name || 'overview').trim();
        if (ko.dashboardSamples.size < MAX_DASHBOARDS_PER_INDEX && !ko.dashboardSamples.has(dash)) {
          ko.dashboardSamples.set(dash, true);
        }
      } else {
        const name = (r.savedsearch_name || '').trim();
        const isScheduled = r.is_scheduled === '1' || r.is_scheduled === 'true';
        const hasAlertAction = !!(r.actions || '').trim();
        const isAlert = hasAlertAction || SECURITY_KEYWORDS.test(name);
        if (isAlert) ko.alertCount += w;
        else if (isScheduled) ko.scheduledSearchCount += w;
        else continue; // ad-hoc rows in this CSV are usage, not inventory

        if (ko.savedSearchSamples.length < MAX_SAVED_SEARCHES_PER_INDEX) {
          ko.savedSearchSamples.push({ name: name || `search_${ko.savedSearchSamples.length}`, isAlert, isScheduled: true });
        }
      }
    }
  }
  log(`Inventory: ${invScanned} rows scanned, ${invAttributed} attributed to tracked indexes`);

  // ── Ad-hoc usage: searches + distinct users per index ──────────────────────
  const usageRows = readSeedCsv('1stmile_dashboard_adhoc_savedsearches_time_usage_lookup.csv');
  const usageByIndex = new Map(); // index → { adhocCount, users:Set }
  let usageScanned = 0;
  for (const r of usageRows) {
    if ((r.search_type || '').trim() !== 'adhoc') continue;
    usageScanned++;
    const refs = extractIndexRefs(expandMacros(r.search || ''), trackedSet);
    if (refs.length === 0) continue;
    const w = 1 / refs.length;
    const user = (r.user || 'unknown').trim();
    for (const idx of refs) {
      if (!usageByIndex.has(idx)) usageByIndex.set(idx, { adhocCount: 0, users: new Set() });
      const u = usageByIndex.get(idx);
      u.adhocCount += w;
      u.users.add(user);
    }
  }
  log(`Usage: ${usageScanned} adhoc rows scanned, ${usageByIndex.size} indexes with adhoc activity`);

  // ── Quality issues per sourcetype ──────────────────────────────────────────
  // Map sourcetype → index via the volume CSV when the quality row lacks one.
  const stToIndex = new Map();
  for (const [idx, stMap] of volume) for (const st of stMap.keys()) stToIndex.set(st, idx);

  const qualityRows = readSeedCsv('1stmile_data_quality_issues_lookupcsv.csv');
  const qualityBySt = new Map(); // sourcetype → { dateParserHits, otherHits, index }
  for (const r of qualityRows) {
    const st = (r.sourcetype || '').trim();
    const hits = parseInt(r.hits || '0', 10);
    if (!st || hits <= 0) continue;
    const idx = (r.index || '').trim() || stToIndex.get(st) || null;
    if (!idx || !trackedSet.has(idx.toLowerCase())) continue;
    const isDateParser = /DateParserVerbose/i.test(r.dq_issue_name || '');
    if (!qualityBySt.has(st)) qualityBySt.set(st, { index: idx, dateParserHits: 0, otherHits: 0 });
    const q = qualityBySt.get(st);
    if (isDateParser) q.dateParserHits += hits;
    else q.otherHits += hits;
  }
  log(`Quality: ${qualityBySt.size} sourcetypes with parsing issues to reproduce`);

  // ── Eventtypes / tags from datamodel mapping ───────────────────────────────
  const dmRows = readSeedCsv('1stmile_index_sourcetype_with_datamodels.csv');
  const eventtypes = dmRows
    .filter(r => r.index && trackedSet.has(r.index.toLowerCase()) && r.sourcetype)
    .map(r => ({
      name: `dm_${r.data_model}_${r.sourcetype}`.toLowerCase().replace(/[^\w]+/g, '_'),
      search: `index=${r.index} sourcetype="${r.sourcetype}"`,
      tag: (r.data_model_hierarchy || r.data_model || 'untagged').toLowerCase().replace(/[^\w]+/g, '_'),
    }));

  // ── Assemble manifest ──────────────────────────────────────────────────────
  const indexes = trackedIndexes.map((idx) => {
    const stMap = volume.get(idx);
    const indexGb = [...stMap.values()].reduce((s, v) => s + v.gb, 0);
    const ko = koByIndex.get(idx.toLowerCase()) || koByIndex.get(idx);
    const usage = usageByIndex.get(idx.toLowerCase()) || usageByIndex.get(idx);
    return {
      name: idx,
      frozenTimePeriodInSecs: retention.get(idx) || 7776000,
      dailyGbInSource: parseFloat(indexGb.toFixed(4)),
      gbProportion: parseFloat((indexGb / totalGb).toFixed(6)),
      sourcetypes: [...stMap.entries()]
        .sort((a, b) => b[1].gb - a[1].gb)
        .map(([st, v]) => ({
          sourcetype: st,
          gbProportion: parseFloat((v.gb / indexGb).toFixed(6)),
          source: v.source,
          quality: qualityBySt.get(st)
            ? { dateParserHits: qualityBySt.get(st).dateParserHits, otherHits: qualityBySt.get(st).otherHits }
            : null,
        })),
      knowledgeObjects: {
        alertCount: Math.round(ko?.alertCount ?? 0),
        scheduledSearchCount: Math.round(ko?.scheduledSearchCount ?? 0),
        dashboardCount: ko ? ko.dashboardSamples.size : 0,
        savedSearchSamples: ko?.savedSearchSamples ?? [],
        dashboardSamples: ko ? [...ko.dashboardSamples.keys()] : [],
      },
      usage: {
        adHocSearchCount: Math.round(usage?.adhocCount ?? 0),
        distinctUsers: usage ? [...usage.users].slice(0, 10) : [],
      },
    };
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    // Raw CSV totals (2-day export from 1stmile Splunk, Oct 26-27 2025)
    sourceTotalDailyGb: parseFloat(totalGb.toFixed(2)),  // sum across all CSV rows
    csvDateCount,                                          // distinct dates in CSV (2)
    csvDailyAvgGb,                                        // sourceTotalDailyGb / csvDateCount (~80 GB)
    // Authoritative customer profile (Teja-confirmed, June 2026)
    logicalDailyIngestGb: LOGICAL_DAILY_INGEST_GB,        // 92 GB — business baseline
    physicalInjectionGb: PHYSICAL_INJECTION_GB,           // 0.25 GB — injected into dev Splunk
    scaleFactor: parseFloat((LOGICAL_DAILY_INGEST_GB / totalGb).toFixed(6)),
    app: 'datasense_demo',
    indexes,
    macros: usefulMacros,
    eventtypes,
    expected: {
      indexCount: indexes.length,
      sourcetypePairCount: indexes.reduce((n, i) => n + i.sourcetypes.length, 0),
      savedSearchCount: indexes.reduce((n, i) => n + i.knowledgeObjects.alertCount + i.knowledgeObjects.scheduledSearchCount, 0),
      dashboardCount: indexes.reduce((n, i) => n + i.knowledgeObjects.dashboardCount, 0),
      macroCount: usefulMacros.length,
      eventtypeCount: eventtypes.length,
      qualitySourcetypes: [...qualityBySt.keys()],
    },
  };

  saveManifest(manifest);
  log(`\n✓ manifest.json written`);
  log(`  indexes: ${manifest.expected.indexCount}`);
  log(`  sourcetype pairs: ${manifest.expected.sourcetypePairCount}`);
  log(`  saved searches planned: ${manifest.expected.savedSearchCount}`);
  log(`  dashboards planned: ${manifest.expected.dashboardCount}`);
  log(`  macros: ${manifest.expected.macroCount}, eventtypes: ${manifest.expected.eventtypeCount}`);
  log(`  quality sourcetypes: ${manifest.expected.qualitySourcetypes.length}`);
}

main();
