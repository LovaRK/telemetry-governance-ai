/**
 * Demo Data Reset Script
 *
 * Clears stale telemetry/pipeline/decision data so the next "Refresh from
 * Splunk" runs against a clean slate. This fixes the "176 indexes shown vs
 * 57 real" symptom: CSV-era rows ingested by ingest-1stmile-csvs.mjs coexist
 * with live-Splunk rows across snapshot_dates and inflate every count.
 *
 * PRESERVES identity, configuration, governance ledger (immutable hash
 * chains), and model-pointer tables (the worker fails fast without an
 * active model pointer).
 *
 * Usage:
 *   node scripts/reset-demo-data.mjs --dry-run   # show what would be cleared
 *   node scripts/reset-demo-data.mjs             # actually clear
 *
 * Env:
 *   DATABASE_URL  (default: postgresql://telemetry:telemetry@localhost:5433/telemetry_os)
 */

import pg from 'pg';

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Telemetry / pipeline / decision data — CLEARED ───────────────────────────
const CLEAR_TABLES = [
  // Core telemetry + decisions
  'telemetry_snapshots',
  'telemetry_facts',
  'agent_decisions',
  'executive_kpis',
  'kpi_change_events',
  // Job + pipeline machinery
  'job_queue',
  'refresh_jobs',
  'reanalysis_job_queue',
  'pipeline_runs',
  'pipeline_events',
  'pipeline_executions',
  'pipeline_event_timeline',
  'pipeline_stage_events',
  'queue_health_metrics',
  'queue_health_summary',
  // Scoring side-tables
  'search_audit',
  'field_usage',
  'security_coverage',
  'quality_hotspots',
  // Snapshot bookkeeping
  'snapshot_metadata',
  'snapshot_certifications',
  'snapshot_certification_rules',
  'tenant_snapshot_pointer',
  'index_metadata_history',
  'index_rolling_baselines',
  'aggregation_watermarks',
  'cache_metadata',
  'cache_coherence_telemetry',
  'cache_coherence_health',
  // Decision-derived analytics
  // human_review_ledger holds FKs into cognitive_enrichments/telemetry_facts;
  // its rows review specific decisions, so it resets with them.
  'human_review_ledger',
  'decision_audit_trail',
  'decision_drift_history',
  'decision_history',
  'decision_lineage',
  'decision_traces',
  'decision_overrides',
  'cognitive_enrichments',
  'recommendation_actions',
  'recommendation_audit_log',
  'drift_event_summary',
  'normalization_rollback_events',
  'normalization_variance',
  'trust_composition_analysis',
  'bidirectional_confidence_analysis',
  'recovery_milestones',
  'confidence_calibration_log',
  'mutation_lifecycle_analysis',
  'mutation_lifecycle_events',
  // Dashboard validation telemetry
  'dashboard_truth_runs',
  'dashboard_truth_failures',
  'dashboard_validation_runs',
  'dashboard_validation_failures',
];

// ── Identity / config / governance / models — PRESERVED ─────────────────────
const PRESERVE_TABLES = [
  // Identity + auth
  'users', 'user_sessions', 'refresh_tokens',
  // Tenancy + configuration
  'tenants', 'tenant_config', 'tenant_audit_log', 'user_config', 'config_audit_log',
  // Governance ledger (immutable, hash-chained — never truncate)
  'governance_audit_events', 'governance_audit_snapshots', 'governance_events_stream',
  'governance_history_timeline', 'governance_health_summary', 'governance_telemetry',
  'governance_mutation_journal', 'governance_replay_journal',
  'envelope_signing_keys', 'envelope_signature_failures',
  'operator_activity_anonymous', 'operator_identity_mapping', 'operator_sessions',
  // Model governance (worker fails fast without active_model_pointer)
  'active_model_pointer', 'approved_models', 'model_benchmarks',
  'model_health_ledger', 'model_promotions',
  // LLM runtime health + prompts
  'llm_execution_metrics', 'llm_health_cache', 'llm_health_history',
  'llm_provider_health', 'llm_prompt_versions', 'prompt_registry',
  // Reference data + migrations
  'confidence_bands_reference', 'snapshot_retention_policy',
  'applied_migrations', 'migration_health', 'migration_locks', 'migration_rollbacks',
];

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  console.log(`Demo data reset ${DRY_RUN ? '(DRY RUN — nothing will be deleted)' : ''}`);
  console.log(`Database: ${DB_URL.replace(/:[^:@/]+@/, ':***@')}\n`);

  try {
    // Guard: every public table must be explicitly categorized.
    const { rows: tables } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`
    );
    const known = new Set([...CLEAR_TABLES, ...PRESERVE_TABLES]);
    const unknown = tables.map(t => t.table_name).filter(t => !known.has(t));
    if (unknown.length > 0) {
      console.error('✗ Uncategorized tables found — refusing to run until they are');
      console.error('  added to CLEAR_TABLES or PRESERVE_TABLES in this script:');
      unknown.forEach(t => console.error(`    - ${t}`));
      process.exit(1);
    }

    // Skip tables in the clear list that don't exist in this database version.
    const existing = new Set(tables.map(t => t.table_name));
    const toClear = CLEAR_TABLES.filter(t => existing.has(t));

    // Before counts
    console.log('Row counts (tables to clear):');
    let totalRows = 0;
    for (const t of toClear) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${t}"`);
      const n = rows[0].n;
      totalRows += n;
      if (n > 0) console.log(`  ${t.padEnd(40)} ${String(n).padStart(8)}`);
    }
    console.log(`  ${'TOTAL'.padEnd(40)} ${String(totalRows).padStart(8)}\n`);

    if (DRY_RUN) {
      console.log('Dry run complete. Re-run without --dry-run to clear these rows.');
      return;
    }

    // Single TRUNCATE statement handles FKs among the cleared set;
    // fails loudly if a preserved table still references a cleared one.
    console.log(`Truncating ${toClear.length} tables...`);
    await pool.query(`TRUNCATE TABLE ${toClear.map(t => `"${t}"`).join(', ')} RESTART IDENTITY`);

    // After counts (verification)
    for (const t of toClear) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${t}"`);
      if (rows[0].n !== 0) throw new Error(`Table ${t} still has ${rows[0].n} rows after truncate`);
    }
    console.log(`✓ Cleared ${totalRows} rows across ${toClear.length} tables.`);

    // Sanity: preserved essentials intact
    for (const t of ['users', 'tenants', 'user_config', 'active_model_pointer']) {
      if (!existing.has(t)) continue;
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${t}"`);
      console.log(`  preserved ${t.padEnd(25)} ${rows[0].n} rows`);
    }
    console.log('\nNext: trigger "Refresh from Splunk" for a clean live-data run.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('✗ Reset failed:', e.message);
  process.exit(1);
});
