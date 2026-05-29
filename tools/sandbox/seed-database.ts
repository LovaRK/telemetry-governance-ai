/**
 * Seed Database — Phase 10
 *
 * Seeds the database with chaos scenario data for sandbox testing.
 * Inserts synthetic Gold-layer snapshots so the dashboard shows the chaos
 * scenarios without needing a live Splunk connection.
 *
 * SAFETY GUARD: Requires ALLOW_SYNTHETIC_DATA=true + APP_ENV=sandbox.
 * Uses CHAOS_SANDBOX as the tenant_id; never touches production data.
 *
 * Usage:
 *   ALLOW_SYNTHETIC_DATA=true APP_ENV=sandbox DATABASE_URL=... \
 *   npx ts-node tools/sandbox/seed-database.ts [--scenario <name>] [--wipe]
 *
 * Options:
 *   --scenario <name>  Only seed a specific scenario (license_growth | zombie_index |
 *                      duplicate_telemetry | cardinality_explosion | roi_boundary_stress)
 *   --wipe             Delete existing CHAOS_SANDBOX data before seeding
 *   --dry-run          Show what would be inserted without writing to DB
 */

import * as crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Safety guard
// ─────────────────────────────────────────────────────────────────────────────

const APP_ENV         = process.env.APP_ENV ?? 'sandbox';
const ALLOW_SYNTHETIC = process.env.ALLOW_SYNTHETIC_DATA === 'true';

if (APP_ENV === 'production') {
  throw new Error('[SeedDatabase] FATAL: APP_ENV=production. Seeding must not run in production.');
}
if (!ALLOW_SYNTHETIC) {
  throw new Error('[SeedDatabase] FATAL: ALLOW_SYNTHETIC_DATA must be "true" to seed the database.');
}

const CHAOS_TENANT_ID = 'CHAOS_SANDBOX';
const SCORING_VERSION = '1.0';
const DRY_RUN         = process.argv.includes('--dry-run');
const WIPE            = process.argv.includes('--wipe');
const SCENARIO_ARG    = (() => {
  const idx = process.argv.indexOf('--scenario');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

import {
  generateFullChaosDataset,
  generateLicenseGrowthScenario,
  generateZombieIndexScenario,
  generateDuplicateTelemetryScenario,
  generateCardinalityExplosionScenario,
  generateROIBoundaryStressScenario,
  type ChaosSnapshot,
} from './chaos-generator';

// ─────────────────────────────────────────────────────────────────────────────
// DB connection (lazy — only required when not in --dry-run)
// ─────────────────────────────────────────────────────────────────────────────

async function getDb() {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ??
      'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
    max: 5,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function syntheticId(prefix: string, ...parts: string[]): string {
  const hash = crypto
    .createHash('sha256')
    .update(parts.join(':'))
    .digest('hex')
    .substring(0, 20);
  return `${prefix}-${hash}`;
}

function snapshotToGoldRow(snap: ChaosSnapshot) {
  const now          = new Date().toISOString();
  const bronzeId     = syntheticId('bronze', CHAOS_TENANT_ID, snap.index_name, snap.sourcetype);
  const silverId     = syntheticId('silver', bronzeId, SCORING_VERSION);
  const goldId       = syntheticId('gold',   silverId, SCORING_VERSION, now);
  const snapshotHash = crypto
    .createHash('sha256')
    .update(goldId + silverId + snap.composite_score.toString())
    .digest('hex');

  return {
    goldId,
    silverId,
    bronzeId,
    snapshotHash,
    indexName:      snap.index_name,
    sourcetype:     snap.sourcetype,
    dailyAvgGb:     snap.daily_avg_gb,
    costPerYear:    snap.cost_per_year,
    utilScore:      snap.utilization_score,
    detectScore:    snap.detection_score,
    qualityScore:   snap.quality_score,
    compositeScore: snap.composite_score,
    tier:           snap.tier,
    action:         snap.classification,
    estimatedSavings: snap.estimated_savings,
    isQuickWin:     snap.is_quick_win,
    isS3Candidate:  snap.is_s3_candidate,
    reasoning:      snap.reasoning,
    metadata:       snap.metadata,
    scenario:       snap.scenario,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Database operations
// ─────────────────────────────────────────────────────────────────────────────

async function wipeChaosTenant(pool: import('pg').Pool): Promise<void> {
  console.log(`[SeedDatabase] Wiping existing CHAOS_SANDBOX data...`);

  // Only wipe chaos tenant — never touch other tenants
  const tables = [
    'gold_telemetry_snapshots',
    'silver_normalized_telemetry',
    'bronze_splunk_events',
    'agent_decisions',
  ];
  for (const table of tables) {
    try {
      const res = await pool.query(
        `DELETE FROM ${table} WHERE tenant_id = $1`,
        [CHAOS_TENANT_ID],
      );
      console.log(`  Deleted ${res.rowCount} rows from ${table}`);
    } catch (err) {
      // Table may not exist yet — safe to ignore
      console.warn(`  Warning: could not wipe ${table}: ${(err as Error).message}`);
    }
  }
}

async function ensureChaosTenantConfig(pool: import('pg').Pool): Promise<void> {
  // Ensure tenant_config row exists for CHAOS_SANDBOX
  try {
    await pool.query(
      `INSERT INTO tenant_config
         (tenant_id, splunk_host, splunk_port, splunk_token, environment, created_at, updated_at)
       VALUES ($1, 'mock-splunk.chaos.internal', 8089, 'chaos_mock_token', 'sandbox', NOW(), NOW())
       ON CONFLICT (tenant_id) DO NOTHING`,
      [CHAOS_TENANT_ID],
    );
  } catch (err) {
    // tenant_config may not exist yet; non-fatal — Gold rows are still useful
    console.warn('[SeedDatabase] Could not create tenant_config:', (err as Error).message);
  }
}

async function seedBronzeRow(pool: import('pg').Pool, row: ReturnType<typeof snapshotToGoldRow>): Promise<void> {
  const rawPayload = {
    index_name:    row.indexName,
    sourcetype:    row.sourcetype,
    daily_avg_gb:  row.dailyAvgGb,
    _synthetic:    true,
    scenario:      row.scenario,
  };

  await pool.query(
    `INSERT INTO bronze_splunk_events
       (id, tenant_id, index_name, sourcetype, raw_payload, extracted_at, extraction_version)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), '1.0')
     ON CONFLICT (id) DO NOTHING`,
    [row.bronzeId, CHAOS_TENANT_ID, row.indexName, row.sourcetype, JSON.stringify(rawPayload)],
  );
}

async function seedSilverRow(pool: import('pg').Pool, row: ReturnType<typeof snapshotToGoldRow>): Promise<void> {
  await pool.query(
    `INSERT INTO silver_normalized_telemetry
       (id, tenant_id, bronze_id, index_name, sourcetype, event_count, distinct_hosts,
        parsing_error_rate, field_coverage_pct, time_span_days, normalized_fields,
        parser_version, normalization_version, normalized_at)
     VALUES ($1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10, $11::jsonb,
             '1.0', '1.0', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      row.silverId,
      CHAOS_TENANT_ID,
      row.bronzeId,
      row.indexName,
      row.sourcetype,
      Math.round(row.dailyAvgGb * 1_000_000),  // synthetic event count
      Math.round(row.dailyAvgGb * 100),          // synthetic host count
      Math.max(0, Math.min(50, 100 - row.qualityScore)), // error rate inverse of quality
      row.qualityScore,
      30,  // 30-day time span
      JSON.stringify({ _synthetic: true, scenario: row.scenario }),
    ],
  );
}

async function seedGoldRow(pool: import('pg').Pool, row: ReturnType<typeof snapshotToGoldRow>): Promise<void> {
  await pool.query(
    `INSERT INTO gold_telemetry_snapshots
       (id, tenant_id, silver_id, index_name, utilization_score, detection_score,
        quality_score, composite_score, tier, minimum_activity_gated,
        scoring_version, scoring_profile, weight_utilization, weight_detection, weight_quality,
        snapshot_hash, scored_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false,
             '1.0', 'balanced', 0.35, 0.40, 0.25,
             $10, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      row.goldId,
      CHAOS_TENANT_ID,
      row.silverId,
      row.indexName,
      row.utilScore,
      row.detectScore,
      row.qualityScore,
      row.compositeScore,
      row.tier,
      row.snapshotHash,
    ],
  );
}

async function seedAgentDecision(pool: import('pg').Pool, row: ReturnType<typeof snapshotToGoldRow>): Promise<void> {
  const decisionId = syntheticId('dec', CHAOS_TENANT_ID, row.indexName, row.action);

  try {
    await pool.query(
      `INSERT INTO agent_decisions
         (id, tenant_id, index_name, sourcetype, action, tier, estimated_savings,
          composite_score, utilization_score, detection_score, quality_score,
          daily_avg_gb, cost_per_year, reasoning, confidence, is_quick_win,
          is_s3_candidate, classification, run_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        decisionId,
        CHAOS_TENANT_ID,
        row.indexName,
        row.sourcetype,
        row.action,
        row.tier,
        row.estimatedSavings,
        row.compositeScore,
        row.utilScore,
        row.detectScore,
        row.qualityScore,
        row.dailyAvgGb,
        row.costPerYear,
        row.reasoning,
        0.85,  // synthetic confidence
        row.isQuickWin,
        row.isS3Candidate,
        row.action,
        syntheticId('run', CHAOS_TENANT_ID, row.scenario),
      ],
    );
  } catch (err) {
    // agent_decisions table may have different schema — non-fatal
    console.warn(`[SeedDatabase] agent_decisions insert skipped for ${row.indexName}: ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[SeedDatabase] Starting chaos data seed...');
  console.log(`  dry_run:  ${DRY_RUN}`);
  console.log(`  wipe:     ${WIPE}`);
  console.log(`  scenario: ${SCENARIO_ARG ?? 'all'}`);

  // Load the appropriate scenarios
  let snapshots: ChaosSnapshot[];
  if (SCENARIO_ARG) {
    const scenarioMap: Record<string, () => ChaosSnapshot[]> = {
      license_growth:       () => generateLicenseGrowthScenario().snapshots,
      zombie_index:         () => generateZombieIndexScenario().snapshots,
      duplicate_telemetry:  () => generateDuplicateTelemetryScenario().snapshots,
      cardinality_explosion: () => generateCardinalityExplosionScenario().snapshots,
      roi_boundary_stress:  () => generateROIBoundaryStressScenario().snapshots,
    };
    const generator = scenarioMap[SCENARIO_ARG];
    if (!generator) {
      throw new Error(`Unknown scenario: ${SCENARIO_ARG}. Valid: ${Object.keys(scenarioMap).join(' | ')}`);
    }
    snapshots = generator();
  } else {
    const full = generateFullChaosDataset();
    snapshots  = full.scenarios.flatMap(s => s.snapshots);
  }

  const rows = snapshots.map(snapshotToGoldRow);

  console.log(`[SeedDatabase] ${rows.length} snapshots to seed`);

  if (DRY_RUN) {
    console.log('[SeedDatabase] DRY RUN — no database writes');
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.indexName}: ${r.tier} / ${r.action} / composite=${r.compositeScore} / savings=$${r.estimatedSavings}`);
    }
    if (rows.length > 5) console.log(`  ... and ${rows.length - 5} more`);
    return;
  }

  const pool = await getDb();

  try {
    if (WIPE) await wipeChaosTenant(pool);
    await ensureChaosTenantConfig(pool);

    let inserted = 0;
    let errors   = 0;

    for (const row of rows) {
      try {
        await seedBronzeRow(pool, row);
        await seedSilverRow(pool, row);
        await seedGoldRow(pool, row);
        await seedAgentDecision(pool, row);
        inserted++;
        if (inserted % 10 === 0) {
          process.stdout.write(`\r[SeedDatabase] Inserted ${inserted}/${rows.length}...`);
        }
      } catch (err) {
        errors++;
        console.warn(`\n[SeedDatabase] Error seeding ${row.indexName}: ${(err as Error).message}`);
      }
    }

    console.log(`\n[SeedDatabase] Done. Inserted: ${inserted}, Errors: ${errors}`);
    console.log(`  View in dashboard: set tenant_id to "${CHAOS_TENANT_ID}"`);

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[SeedDatabase] Fatal error:', err);
  process.exit(1);
});
