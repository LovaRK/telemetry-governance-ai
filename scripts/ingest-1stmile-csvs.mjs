/**
 * 1stMile Production CSV Ingestion Script
 *
 * Processes 10 CSV files from 1stMile Splunk environment and ingests scored
 * data into datasensAI database using the exact formulas from the PDF:
 *
 * Utilization  = weighted_sum / max_weighted_sum × 100
 * Detection    = (0.40 × potential) + (0.60 × realized)
 * Quality      = max(0, 100 − (issue_density × 2000))
 * Composite    = (0.35 × Util) + (0.40 × Det) + (0.25 × Qual)
 * Tier         = ≥65:T1, ≥40:T2, ≥20:T3, <20:T4
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';
import { randomUUID } from 'crypto';

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os';
const DATA_DIR = process.env.DATA_DIR || '/tmp/1stmile-files/1stmile-files';
const COST_PER_GB_YEAR = 3650; // $10/GB/day × 365 ≈ $3,650/GB/year
const DRY_RUN = process.argv.includes('--dry-run');

// Resolve tenant ID: prefer env var, then query DB for the first real tenant
async function resolveTenantId(pool) {
  if (process.env.TENANT_ID) {
    console.log(`  Tenant ID from env: ${process.env.TENANT_ID}`);
    return process.env.TENANT_ID;
  }
  // Prefer a tenant that has Splunk configured (is_configured=true).
  // Order by created_at ASC so the first real tenant wins, not a test tenant
  // inserted later by the test suite.
  const result = await pool.query(`
    SELECT id, name FROM tenants
    WHERE name NOT ILIKE '%test%'
      AND name NOT ILIKE '%lifecycle%'
      AND name NOT ILIKE '%integration%'
    ORDER BY created_at ASC NULLS LAST
    LIMIT 1
  `);
  if (result.rows.length === 0) {
    // Fallback: any tenant, oldest first
    const fallback = await pool.query(`SELECT id, name FROM tenants ORDER BY created_at ASC LIMIT 1`);
    if (fallback.rows.length === 0) throw new Error('No tenant found in database');
    const { id, name } = fallback.rows[0];
    console.log(`  Tenant ID from DB (fallback): ${id} (${name})`);
    return id;
  }
  const { id, name } = result.rows[0];
  console.log(`  Tenant ID from DB: ${id} (${name})`);
  return id;
}

// ── Weights (defaults from PDF) ──────────────────────────────────────────────
const WEIGHTS = { util: 0.35, det: 0.40, qual: 0.25 };

// ── Security keywords for detection classification ───────────────────────────
const SECURITY_APPS = new Set([
  'SplunkEnterpriseSecuritySuite', 'SA-AccessProtection', 'SA-AuditAndDataProtection',
  'SA-EndpointProtection', 'SA-IdentityManagement', 'SA-NetworkProtection',
  'SA-ThreatIntelligence', 'DA-ESS-ThreatIntelligence', 'DA-ESS-AccessProtection',
  'Splunk_SA_ExtremeSearch', 'Splunk_SOAR', 'phantom',
]);
const SECURITY_KEYWORDS_STRONG = [
  'alert', 'detect', 'threat', 'attack', 'suspicious', 'malicious', 'brute',
  'lateral', 'privilege', 'anomal', 'compromise', 'exploit', 'exfiltrat',
  'intrusion', 'incident', 'forensic', 'investigat', 'impossible', 'improbable',
  'logon', 'account', 'audit', 'denied', 'banned', 'blocked',
];
const SECURITY_KEYWORDS_WEAK = ['access', 'login', 'failed', 'failure'];

// ── CSV reader ────────────────────────────────────────────────────────────────
async function readCSV(filename) {
  const rows = [];
  const rl = createInterface({
    input: createReadStream(`${DATA_DIR}/${filename}`),
    crlfDelay: Infinity,
  });
  let headers = null;
  for await (const line of rl) {
    const cols = parseCSVLine(line);
    if (!headers) { headers = cols; continue; }
    const row = {};
    headers.forEach((h, i) => { row[h.replace(/^"|"$/g, '')] = (cols[i] || '').replace(/^"|"$/g, ''); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

// ── Score computation (PDF formulas) ─────────────────────────────────────────

function computeUtilization(sourcetypeData, maxWeightedSum) {
  const { alerts, scheduled, dashboards, adhoc, users } = sourcetypeData;
  const ws = (alerts * 3) + (scheduled * 3) + (dashboards * 2) + (adhoc * 1) + (users * 2);
  return maxWeightedSum > 0 ? (ws / maxWeightedSum) * 100 : 0;
}

function computeDetection(mitreTechniques, lanternUsecases, alertCount, maxAlertCount) {
  // Hard rule: if both 0, detection = 0
  if (mitreTechniques === 0 && lanternUsecases === 0) return 0;
  const mitrePotential = Math.min(100, mitreTechniques * 1.25);
  const lanternPotential = Math.min(100, lanternUsecases * 6.0);
  const potential = Math.max(mitrePotential, lanternPotential);
  const realized = maxAlertCount > 0 ? (alertCount / maxAlertCount) * 100 : 0;
  return (0.40 * potential) + (0.60 * realized);
}

function computeQuality(weightedIssues, dailyGb) {
  if (dailyGb <= 0) return 100; // No volume = no issue density
  const approxEvents = dailyGb * 1_000_000;
  const issueDensity = weightedIssues / approxEvents;
  return Math.max(0, 100 - (issueDensity * 2000));
}

function computeComposite(util, det, qual) {
  return (WEIGHTS.util * util) + (WEIGHTS.det * det) + (WEIGHTS.qual * qual);
}

function assignTier(composite) {
  if (composite >= 65) return 'Critical';
  if (composite >= 40) return 'Important';
  if (composite >= 20) return 'Nice-to-Have';
  return 'Wasteful';
}

function tierToAction(tier) {
  if (tier === 'Critical') return 'KEEP';
  if (tier === 'Important') return 'KEEP';
  if (tier === 'Nice-to-Have') return 'OPTIMIZE';
  return 'ELIMINATE';
}

// DB classification column uses different values than tier labels
function tierToClassification(tier) {
  if (tier === 'Critical') return 'KEEP';
  if (tier === 'Important') return 'INVESTIGATE';
  if (tier === 'Nice-to-Have') return 'OPTIMIZE';
  return 'ELIMINATE';
}

// ── Main ingestion ────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 1stMile CSV Ingestion Pipeline');
  console.log('='.repeat(50));
  if (DRY_RUN) console.log('  ⚠️  DRY RUN — no database writes');
  console.log(`DB: ${DB_URL}`);

  const pool = new Pool({ connectionString: DB_URL });
  const TENANT_ID = await resolveTenantId(pool);
  console.log(`Tenant: ${TENANT_ID}`);

  // ── Step 1: Load all CSVs ──────────────────────────────────────────────────
  console.log('\n📂 Loading CSV files...');
  const [volumeRows, searchRows, adhocRows, qualityRows, metadataRows, datamodelRows] = await Promise.all([
    readCSV('1stmile_index_sourcetype_and_source_volume_lookupcsv.csv'),
    readCSV('1stmile_dashboard_savedsearches_inventory_lookup.csv'),
    readCSV('1stmile_dashboard_adhoc_savedsearches_time_usage_lookup.csv'),
    readCSV('1stmile_data_quality_issues_lookupcsv.csv'),
    readCSV('1stmile_index_metadata_lookupcsv.csv'),
    readCSV('1stmile_index_sourcetype_with_datamodels.csv'),
  ]);

  console.log(`  Volume rows: ${volumeRows.length}`);
  console.log(`  Search inventory rows: ${searchRows.length}`);
  console.log(`  Ad-hoc usage rows: ${adhocRows.length}`);
  console.log(`  Quality issue rows: ${qualityRows.length}`);
  console.log(`  Index metadata rows: ${metadataRows.length}`);
  console.log(`  Datamodel rows: ${datamodelRows.length}`);

  // ── Step 2: Aggregate daily GB per sourcetype ──────────────────────────────
  console.log('\n📊 Aggregating volume data...');
  const sourcetypeVolume = new Map(); // sourcetype -> { totalGb, index }
  const indexVolume = new Map();

  for (const row of volumeRows) {
    const st = row['sourcetype'];
    const idx = row['index'];
    const gb = parseFloat(row['GB_idx_st_s']) || 0;
    if (!st) continue;

    const prev = sourcetypeVolume.get(st) || { totalGb: 0, index: idx };
    sourcetypeVolume.set(st, { totalGb: prev.totalGb + gb, index: idx });

    const idxGb = indexVolume.get(idx) || 0;
    indexVolume.set(idx, idxGb + gb);
  }
  console.log(`  Unique sourcetypes with volume: ${sourcetypeVolume.size}`);
  console.log(`  Unique indexes: ${indexVolume.size}`);

  // ── Step 3: Parse saved searches for Utilization ──────────────────────────
  console.log('\n🔍 Parsing saved searches...');
  // Map: sourcetype → {alerts, scheduled, dashboards}
  // We'll use index→sourcetype from volume CSV to resolve index= references
  const indexToSourcetypes = new Map();
  for (const row of volumeRows) {
    const idx = row['index'];
    const st = row['sourcetype'];
    if (!idx || !st) continue;
    if (!indexToSourcetypes.has(idx)) indexToSourcetypes.set(idx, new Set());
    indexToSourcetypes.get(idx).add(st);
  }

  // Count KOs per sourcetype
  const sourcetypeKOs = new Map();
  const sourcetypeAlerts = new Map(); // for detection score

  for (const row of searchRows) {
    if (row['disabled'] === '1') continue; // Skip disabled searches
    const searchName = row['savedsearch_name'] || '';
    const searchType = row['search_type'] || '';
    const app = row['app'] || '';
    const search = (row['search'] || '').toLowerCase();

    // Resolve sourcetypes from the search
    const resolvedSourcetypes = resolveSourcetypesFromSearch(search, indexToSourcetypes, sourcetypeVolume);
    if (resolvedSourcetypes.size === 0) continue;

    const weight = 1 / resolvedSourcetypes.size; // Attribution weighting

    // Classify KO type
    const isAlert = searchType === 'alert' ||
      (isSecuritySearch(searchName.toLowerCase(), app) && row['is_scheduled'] === '1');
    const isScheduled = row['is_scheduled'] === '1';
    const isDashboard = searchType === 'dashboard';

    for (const st of resolvedSourcetypes) {
      const ko = sourcetypeKOs.get(st) || { alerts: 0, scheduled: 0, dashboards: 0, adhoc: 0 };
      if (isAlert) {
        ko.alerts += weight;
        const prev = sourcetypeAlerts.get(st) || 0;
        sourcetypeAlerts.set(st, prev + weight);
      } else if (isScheduled) {
        ko.scheduled += weight;
      } else if (isDashboard) {
        ko.dashboards += weight;
      }
      sourcetypeKOs.set(st, ko);
    }
  }

  // ── Step 4: Count unique users per sourcetype (ad-hoc usage) ──────────────
  const sourcetypeUsers = new Map(); // sourcetype → Set<user>

  for (const row of adhocRows) {
    const user = row['user'] || '';
    if (!user || user === 'nobody') continue;
    const search = (row['search'] || '').toLowerCase();
    const resolvedSourcetypes = resolveSourcetypesFromSearch(search, indexToSourcetypes, sourcetypeVolume);

    const weight = resolvedSourcetypes.size > 0 ? 1 / resolvedSourcetypes.size : 1;
    for (const st of resolvedSourcetypes) {
      if (!sourcetypeUsers.has(st)) sourcetypeUsers.set(st, new Set());
      sourcetypeUsers.get(st).add(user);
    }
  }

  // ── Step 5: Parse quality issues ──────────────────────────────────────────
  const sourcetypeQuality = new Map(); // sourcetype → weighted issue sum
  for (const row of qualityRows) {
    const st = row['sourcetype'];
    const hits = parseInt(row['hits'] || '0', 10);
    const issueName = row['dq_issue_name'] || '';
    if (!st) continue;

    // DateParserVerbose counts at 0.5×
    const weight = issueName.includes('DateParserVerbose') ? 0.5 : 1.0;
    const prev = sourcetypeQuality.get(st) || 0;
    sourcetypeQuality.set(st, prev + (hits * weight));
  }

  // ── Step 6: Parse index metadata (retention) ──────────────────────────────
  const indexMetadata = new Map();
  for (const row of metadataRows) {
    const idx = row['index'];
    const retention = parseInt(row['frozenTimePeriodInSecs'] || '7776000', 10);
    const dbSizeMB = parseInt(row['currentDBSizeMB'] || '0', 10);
    const smartStore = row['smart_store_enabled'] === '1';
    indexMetadata.set(idx, {
      retentionDays: Math.round(retention / 86400),
      dbSizeMB,
      smartStore,
    });
  }

  // ── Step 7: Compute scores ─────────────────────────────────────────────────
  console.log('\n🧮 Computing scores...');

  // First pass: compute weighted sums to find max
  const sourcetypeWeightedSums = new Map();
  for (const [st, vol] of sourcetypeVolume) {
    const ko = sourcetypeKOs.get(st) || { alerts: 0, scheduled: 0, dashboards: 0, adhoc: 0 };
    const users = sourcetypeUsers.get(st)?.size || 0;
    const ws = (ko.alerts * 3) + (ko.scheduled * 3) + (ko.dashboards * 2) + (ko.adhoc * 1) + (users * 2);
    sourcetypeWeightedSums.set(st, ws);
  }
  const maxWeightedSum = Math.max(...sourcetypeWeightedSums.values(), 1);
  const maxAlertCount = Math.max(...Array.from(sourcetypeAlerts.values()), 1);

  console.log(`  Max weighted sum: ${maxWeightedSum.toFixed(2)}`);
  console.log(`  Max alert count: ${maxAlertCount.toFixed(2)}`);

  const scoredSourcetypes = [];

  for (const [st, vol] of sourcetypeVolume) {
    const dailyGb = vol.totalGb;
    const idx = vol.index;
    const ko = sourcetypeKOs.get(st) || { alerts: 0, scheduled: 0, dashboards: 0, adhoc: 0 };
    const users = sourcetypeUsers.get(st)?.size || 0;
    const ws = sourcetypeWeightedSums.get(st) || 0;
    const alertCount = sourcetypeAlerts.get(st) || 0;
    const weightedIssues = sourcetypeQuality.get(st) || 0;
    const meta = indexMetadata.get(idx) || { retentionDays: 90, dbSizeMB: 0, smartStore: false };

    // MITRE/Lantern: use 0 for now (no mapping CSV provided)
    // TODO: load from sourcetype_attack_mapping.csv when available
    const mitreTechniques = 0;
    const lanternUsecases = 0;

    const utilScore = maxWeightedSum > 0 ? (ws / maxWeightedSum) * 100 : 0;
    const detScore = computeDetection(mitreTechniques, lanternUsecases, alertCount, maxAlertCount);
    const qualScore = computeQuality(weightedIssues, dailyGb);
    const composite = computeComposite(utilScore, detScore, qualScore);
    const tier = assignTier(composite);
    const action = tierToAction(tier);
    const annualCost = dailyGb * COST_PER_GB_YEAR;

    // Gap flags
    const detectionGap = mitreTechniques >= 15 && (alertCount / Math.max(mitreTechniques, 1) * 100) < 25;
    const operationalGap = lanternUsecases >= 4 && alertCount === 0;

    scoredSourcetypes.push({
      st, idx, dailyGb, retentionDays: meta.retentionDays,
      utilScore, detScore, qualScore, composite, tier, action, annualCost,
      ko, users, alertCount, mitreTechniques, lanternUsecases,
      weightedIssues, detectionGap, operationalGap,
      confidence: 0.90, // High confidence: direct volume/search data
    });
  }

  // Sort by composite desc
  scoredSourcetypes.sort((a, b) => b.composite - a.composite);
  console.log(`  Scored sourcetypes: ${scoredSourcetypes.length}`);

  // Tier distribution
  const tierDist = { Critical: 0, Important: 0, 'Nice-to-Have': 0, Wasteful: 0 };
  scoredSourcetypes.forEach(s => tierDist[s.tier]++);
  console.log(`  Tier 1 Critical: ${tierDist.Critical}`);
  console.log(`  Tier 2 Important: ${tierDist.Important}`);
  console.log(`  Tier 3 Nice-to-Have: ${tierDist['Nice-to-Have']}`);
  console.log(`  Tier 4 Wasteful: ${tierDist.Wasteful}`);

  // Top 5 by composite
  console.log('\n  Top 5 sourcetypes:');
  scoredSourcetypes.slice(0, 5).forEach(s =>
    console.log(`    ${s.st.padEnd(40)} Composite:${s.composite.toFixed(1).padStart(6)} [${s.tier}] $${s.annualCost.toFixed(0)}/yr`)
  );

  // ── Step 8: Compute KPIs ──────────────────────────────────────────────────
  const totalDailyGb = scoredSourcetypes.reduce((s, r) => s + r.dailyGb, 0);
  const totalSpend = scoredSourcetypes.reduce((s, r) => s + r.annualCost, 0);
  const tier12Gb = scoredSourcetypes.filter(r => ['Critical','Important'].includes(r.tier))
    .reduce((s, r) => s + r.dailyGb, 0);
  const tier34Spend = scoredSourcetypes.filter(r => ['Nice-to-Have','Wasteful'].includes(r.tier))
    .reduce((s, r) => s + r.annualCost, 0);
  const roiScore = scoredSourcetypes.reduce((s, r) => s + r.composite, 0) / Math.max(scoredSourcetypes.length, 1);
  const gainScope = totalDailyGb > 0 ? (tier12Gb / totalDailyGb) * 100 : 0;
  const avgUtil = scoredSourcetypes.reduce((s, r) => s + r.utilScore, 0) / Math.max(scoredSourcetypes.length, 1);
  const avgDet = scoredSourcetypes.reduce((s, r) => s + r.detScore, 0) / Math.max(scoredSourcetypes.length, 1);
  const avgQual = scoredSourcetypes.reduce((s, r) => s + r.qualScore, 0) / Math.max(scoredSourcetypes.length, 1);
  const avgConf = scoredSourcetypes.reduce((s, r) => s + r.confidence, 0) / Math.max(scoredSourcetypes.length, 1) * 100;
  const securityGaps = scoredSourcetypes.filter(r => r.detectionGap).length;
  const operationalGaps = scoredSourcetypes.filter(r => r.operationalGap).length;

  // Tier spend
  const tierSpend = { t1: 0, t2: 0, t3: 0, t4: 0 };
  scoredSourcetypes.forEach(r => {
    if (r.tier === 'Critical') tierSpend.t1 += r.annualCost;
    else if (r.tier === 'Important') tierSpend.t2 += r.annualCost;
    else if (r.tier === 'Nice-to-Have') tierSpend.t3 += r.annualCost;
    else tierSpend.t4 += r.annualCost;
  });

  // Quick wins: top 5 highest-cost Tier 3+4 sourcetypes (real savings opportunity)
  const quickWins = scoredSourcetypes
    .filter(r => ['Nice-to-Have', 'Wasteful'].includes(r.tier) && r.annualCost > 0)
    .sort((a, b) => b.annualCost - a.annualCost)
    .slice(0, 5)
    .map(r => ({
      indexName: `${r.idx}:${r.st}`,
      action: r.tier === 'Wasteful' ? 'ELIMINATE' : 'OPTIMIZE',
      savings: r.annualCost * (r.tier === 'Wasteful' ? 0.95 : 0.5),
      tier: r.tier,
      reasoning: `${r.tier} tier (composite ${r.composite.toFixed(0)}): $${r.annualCost.toFixed(0)}/yr, Util:${r.utilScore.toFixed(0)} Det:${r.detScore.toFixed(0)} Qual:${r.qualScore.toFixed(0)}.`,
    }));

  // Savings Staircase (5 stages per PDF §8)
  const eliminateCount = tierDist.Wasteful;
  const optimizeCount  = tierDist['Nice-to-Have'];
  const afterEliminate = totalSpend - tierSpend.t4;
  const afterOptimize  = afterEliminate - (tierSpend.t3 * 0.50); // 50% reduction from optimization
  const afterRetention = afterOptimize  * 0.90;                   // 10% additional from retention tuning
  const optimizedTarget = tierSpend.t1 + tierSpend.t2;            // Keep only Tier 1+2

  const savingsStaircase = [
    { label: 'Current',            savings: 0,                              cumulative: totalSpend,      action: 'baseline',  count: scoredSourcetypes.length },
    { label: 'After Eliminations', savings: tierSpend.t4,                   cumulative: afterEliminate,  action: 'ELIMINATE', count: eliminateCount },
    { label: 'After Optimization', savings: totalSpend - afterOptimize,     cumulative: afterOptimize,   action: 'OPTIMIZE',  count: optimizeCount },
    { label: 'After Retention',    savings: totalSpend - afterRetention,    cumulative: afterRetention,  action: 'RETAIN',    count: optimizeCount },
    { label: 'Target',             savings: totalSpend - optimizedTarget,   cumulative: optimizedTarget, action: 'TARGET',    count: 2 },
  ];

  console.log('\n📈 KPI Summary:');
  console.log(`  ROI Score: ${roiScore.toFixed(1)}`);
  console.log(`  GainScope: ${gainScope.toFixed(1)}%`);
  console.log(`  Total Daily GB: ${totalDailyGb.toFixed(2)} GB`);
  console.log(`  Annual Spend: $${totalSpend.toFixed(0)}`);
  console.log(`  Low-Value Spend: $${tier34Spend.toFixed(0)}`);
  console.log(`  Security Gaps: ${securityGaps}`);
  console.log(`  Operational Gaps: ${operationalGaps}`);

  // ── Step 9: Write to database ─────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('\n✅ DRY RUN complete — all checks passed. No rows written.');
    console.log(`   Re-run without --dry-run to commit ${scoredSourcetypes.length} sourcetypes.`);
    await pool.end();
    return;
  }
  console.log('\n💾 Writing to database...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // RLS: set tenant context so policies allow writes
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_ID]);

    const snapshotId = randomUUID();
    const snapshotDate = new Date().toISOString().split('T')[0];

    // Write telemetry_snapshots
    let insertedSnapshots = 0;
    for (const row of scoredSourcetypes) {
      const classification = tierToClassification(row.tier);

      await client.query(`
        INSERT INTO telemetry_snapshots (
          snapshot_id, snapshot_date, granularity, index_name, sourcetype,
          total_events, daily_avg_gb, retention_days, utilization_pct,
          cost_per_year, risk_score, classification, confidence,
          recommendation, evidence, raw_metadata, tenant_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT DO NOTHING
      `, [
        snapshotId, snapshotDate, 'sourcetype',
        row.idx, row.st,
        Math.round(row.dailyGb * 1_000_000), // approx events
        row.dailyGb, row.retentionDays, row.utilScore.toFixed(2),
        row.annualCost.toFixed(2), (100 - row.composite).toFixed(2), classification,
        row.confidence.toFixed(4),
        `${row.action}: Composite score ${row.composite.toFixed(1)} (U:${row.utilScore.toFixed(0)} D:${row.detScore.toFixed(0)} Q:${row.qualScore.toFixed(0)})`,
        JSON.stringify([]),
        JSON.stringify({ source: '1stmile-csvs', runDate: new Date().toISOString() }),
        TENANT_ID
      ]);
      insertedSnapshots++;
    }
    console.log(`  Inserted ${insertedSnapshots} telemetry snapshots`);

    // Write governance_audit_events — one record per sourcetype per snapshot
    // This is the immutable scoring-decision audit trail: scores → tier → recommendation
    let insertedAuditEvents = 0;
    for (const row of scoredSourcetypes) {
      await client.query(`
        INSERT INTO governance_audit_events (
          tenant_id, snapshot_id, sourcetype, index_name,
          composite_score, utilization_score, detection_score, quality_score,
          tier, recommendation, decision_source, reasoning
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT DO NOTHING
      `, [
        TENANT_ID, snapshotId, row.st, row.idx,
        row.composite.toFixed(2), row.utilScore.toFixed(2),
        row.detScore.toFixed(2), row.qualScore.toFixed(2),
        row.tier,
        `${row.action}: ${row.tier} tier — composite ${row.composite.toFixed(1)}`,
        'csv_analytics',
        JSON.stringify({
          weights:    { utilization: 0.35, detection: 0.40, quality: 0.25 },
          components: {
            utilization: { score: row.utilScore.toFixed(2), inputs: { alerts: row.ko.alerts, scheduled: row.ko.scheduled, dashboards: row.ko.dashboards, adhoc: row.ko.adhoc, users: row.users } },
            detection:   { score: row.detScore.toFixed(2), inputs: { mitre_techniques: row.mitreTechniques, lantern_usecases: row.lanternUsecases, alert_count: row.alertCount } },
            quality:     { score: row.qualScore.toFixed(2), inputs: { weighted_issues: row.weightedIssues, daily_gb: row.dailyGb } },
          },
          tier_thresholds: { critical: 65, important: 40, nice_to_have: 20, wasteful: 0 },
          annual_cost_usd: row.annualCost.toFixed(2),
          cost_per_gb_year: COST_PER_GB_YEAR,
        })
      ]);
      insertedAuditEvents++;
    }
    console.log(`  Inserted ${insertedAuditEvents} governance audit events`);

    // Write agent_decisions
    let insertedDecisions = 0;
    for (const row of scoredSourcetypes) {
      await client.query(`
        INSERT INTO agent_decisions (
          snapshot_id, snapshot_date, index_name, sourcetype, tier, action,
          composite_score, utilization_score, detection_score, quality_score,
          risk_score, annual_license_cost, estimated_savings, confidence,
          confidence_score, recommendation, reasoning, evidence,
          is_quick_win, is_s3_candidate, detection_gap, candidate_reason, tenant_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT DO NOTHING
      `, [
        snapshotId, snapshotDate, row.idx, row.st,
        row.tier, row.action,
        row.composite.toFixed(2), row.utilScore.toFixed(2),
        row.detScore.toFixed(2), row.qualScore.toFixed(2),
        (100 - row.composite).toFixed(2),
        row.annualCost.toFixed(2),
        // estimated savings: Wasteful=95%, Nice-to-Have=50% of annual cost
        (row.tier === 'Wasteful' ? row.annualCost * 0.95 :
         row.tier === 'Nice-to-Have' ? row.annualCost * 0.50 : 0).toFixed(2),
        row.confidence.toFixed(4), (row.composite).toFixed(2),
        `${row.action}: ${row.tier} tier — ${row.st}`,
        `Utilization=${row.utilScore.toFixed(1)}, Detection=${row.detScore.toFixed(1)}, Quality=${row.qualScore.toFixed(1)}. Annual cost $${row.annualCost.toFixed(0)}.`,
        JSON.stringify([]),
        // Quick win: top-cost Tier 3+4 sourcetypes with meaningful annual cost
        ['Nice-to-Have','Wasteful'].includes(row.tier) && row.annualCost > 500,
        // S3 candidate: large Nice-to-Have with zero detection coverage
        row.dailyGb > 1 && ['Nice-to-Have','Wasteful'].includes(row.tier) && row.detScore === 0,
        row.detectionGap,
        row.operationalGap ? ['operational_gap'] : [],
        TENANT_ID
      ]);
      insertedDecisions++;
    }
    console.log(`  Inserted ${insertedDecisions} agent decisions`);

    // Populate recommendation_actions (governance workflow layer)
    // Each agent_decision needs a corresponding recommendation_action so the
    // GovernanceWorkflowPanel can surface it for human review.
    await client.query(`
      INSERT INTO recommendation_actions (
        decision_id, snapshot_id, index_name, tenant_id, status, created_at, updated_at
      )
      SELECT
        ad.id,
        ad.snapshot_id,
        ad.index_name,
        ad.tenant_id::uuid,
        CASE
          WHEN ad.is_quick_win = true                                     THEN 'UNDER_REVIEW'::recommendation_status
          WHEN ad.action = 'ELIMINATE' AND ad.annual_license_cost > 10000 THEN 'UNDER_REVIEW'::recommendation_status
          ELSE 'NEW'::recommendation_status
        END,
        NOW(), NOW()
      FROM agent_decisions ad
      WHERE ad.snapshot_id = $1
        AND ad.tenant_id = $2
      ON CONFLICT DO NOTHING
    `, [snapshotId, TENANT_ID]);
    const recCount = await client.query(
      `SELECT COUNT(*) FROM recommendation_actions WHERE snapshot_id = $1 AND tenant_id = $2`,
      [snapshotId, TENANT_ID]
    );
    console.log(`  Populated ${recCount.rows[0].count} recommendation_actions (governance queue)`);

    // Write executive_kpis
    await client.query(`
      INSERT INTO executive_kpis (
        snapshot_id, snapshot_date, roi_score, gainscope_score,
        total_license_spend, license_spend_low_value, storage_savings_potential,
        total_daily_gb, total_sourcetypes,
        tier_critical, tier_important, tier_nice_to_have, tier_low_value,
        security_gaps, operational_gaps,
        avg_utilization, avg_detection, avg_quality, avg_confidence,
        quick_wins, savings_staircase, agent_reasoning,
        tier_1_spend_annual, tier_2_spend_annual, tier_3_spend_annual, tier_4_spend_annual,
        tenant_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,$26,$27
      )
      ON CONFLICT DO NOTHING
    `, [
      snapshotId, snapshotDate,
      roiScore.toFixed(2), gainScope.toFixed(2),
      totalSpend.toFixed(2), tier34Spend.toFixed(2), tier34Spend.toFixed(2), // savings = low-value spend
      totalDailyGb.toFixed(4), scoredSourcetypes.length,
      tierDist.Critical, tierDist.Important, tierDist['Nice-to-Have'], tierDist.Wasteful,
      securityGaps, operationalGaps,
      avgUtil.toFixed(2), avgDet.toFixed(2), avgQual.toFixed(2), avgConf.toFixed(2),
      JSON.stringify(quickWins), JSON.stringify(savingsStaircase),
      `1stMile Splunk environment: ${scoredSourcetypes.length} sourcetypes scored. ROI Score ${roiScore.toFixed(1)}, GainScope ${gainScope.toFixed(1)}%. ${tierDist.Critical} Critical, ${tierDist.Important} Important, ${tierDist['Nice-to-Have']} Nice-to-Have, ${tierDist.Wasteful} Wasteful sourcetypes. Annual license spend $${totalSpend.toFixed(0)}, of which $${tier34Spend.toFixed(0)} (${totalSpend > 0 ? (tier34Spend/totalSpend*100).toFixed(0) : 0}%) is low-value.`,
      tierSpend.t1.toFixed(2), tierSpend.t2.toFixed(2), tierSpend.t3.toFixed(2), tierSpend.t4.toFixed(2),
      TENANT_ID
    ]);
    console.log(`  Inserted executive KPIs row`);

    // Create a published pipeline_run so getLatestPublishedRun picks this snapshot
    const runId = randomUUID();
    // Use runId itself as idempotency hash to guarantee uniqueness
    const idempHash = runId.replace(/-/g, '').slice(0, 64);
    await client.query(`
      INSERT INTO pipeline_runs (
        run_id, snapshot_id, tenant_id, status, published, published_at,
        started_at, model_name, pipeline_version, model_version, prompt_version,
        splunk_query_version, llm_provider, batch_count, source_hash, snapshot_hash, idempotency_hash
      ) VALUES ($1,$2,$3,'SUCCEEDED',true,NOW(),NOW(),'csv-ingestion','2.0.0','csv','1.0','1.0','csv',0,$4,$5,$6)
      ON CONFLICT (run_id) DO NOTHING
    `, [runId, snapshotId, TENANT_ID,
        Buffer.from('1stmile-source').toString('hex').slice(0, 64),
        Buffer.from(snapshotId).toString('hex').slice(0, 64),
        idempHash]);
    console.log(`  Created pipeline_run: ${runId}`);

    // Update the csv_analytics pointer — never touches splunk_live
    await client.query(`
      INSERT INTO tenant_snapshot_pointer
        (tenant_id, snapshot_source, active_run_id, active_snapshot_id, updated_at)
      VALUES ($1, 'csv_analytics', $2, $3, NOW())
      ON CONFLICT (tenant_id, snapshot_source) DO UPDATE SET
        active_run_id      = EXCLUDED.active_run_id,
        active_snapshot_id = EXCLUDED.active_snapshot_id,
        updated_at         = NOW()
    `, [TENANT_ID, runId, snapshotId]);
    console.log(`  Updated tenant_snapshot_pointer [csv_analytics] → run ${runId}`);

    // Update cache_metadata (simple key-value style)
    await client.query(`
      INSERT INTO cache_metadata (cache_key, status, last_refresh_at, record_count, source_type)
      VALUES ('index_metrics', 'fresh', NOW(), $1, 'csv')
      ON CONFLICT (cache_key) DO UPDATE SET
        status = 'fresh',
        last_refresh_at = NOW(),
        record_count = EXCLUDED.record_count,
        updated_at = NOW()
    `, [insertedSnapshots]);
    console.log(`  Updated cache_metadata`);

    await client.query('COMMIT');
    console.log('\n✅ Database write complete!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database write failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n🎉 Ingestion complete!');
  console.log(`   Snapshot ID: will be visible in dashboard`);
  console.log(`   ${scoredSourcetypes.length} sourcetypes → ROI Score: ${roiScore.toFixed(1)}, GainScope: ${gainScope.toFixed(1)}%`);
}

// ── Helper: resolve sourcetypes from a Splunk search string ──────────────────
function resolveSourcetypesFromSearch(searchStr, indexToSourcetypes, sourcetypeVolume) {
  const resolved = new Set();

  // Direct sourcetype= matches
  const stMatches = [...searchStr.matchAll(/sourcetype\s*=\s*["']?([^"'\s,\)]+)["']?/gi)];
  for (const m of stMatches) {
    const st = m[1].replace(/['"]/g, '').trim();
    if (sourcetypeVolume.has(st)) resolved.add(st);
  }

  // index= references → map to all sourcetypes in that index
  const idxMatches = [...searchStr.matchAll(/index\s*=\s*["']?([^"'\s,\)]+)["']?/gi)];
  for (const m of idxMatches) {
    const idx = m[1].replace(/['"]/g, '').trim();
    const sts = indexToSourcetypes.get(idx);
    if (sts) sts.forEach(st => resolved.add(st));
  }

  return resolved;
}

function isSecuritySearch(name, app) {
  if (SECURITY_APPS.has(app)) return true;
  if (SECURITY_KEYWORDS_STRONG.some(kw => name.includes(kw))) return true;
  if (SECURITY_KEYWORDS_WEAK.some(kw => name.includes(kw)) && SECURITY_APPS.has(app)) return true;
  return false;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
