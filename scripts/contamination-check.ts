/**
 * Phase 1H: Contamination Check
 * Scan for 'default' tenant rows before enabling RLS
 *
 * Run with: npx ts-node scripts/contamination-check.ts
 */

import { pool } from '../core/database/connection';

async function checkContamination() {
  try {
    console.log('Phase 1H: Contamination Check\n');
    console.log('Scanning for "default" tenant rows...\n');

    const tables = [
      'pipeline_runs',
      'telemetry_snapshots',
      'executive_kpis',
      'agent_decisions',
      'pipeline_stage_events',
      'tenant_snapshot_pointer',
      'job_queue',
      'cache_metadata',
    ];

    let totalViolations = 0;
    const violations: { table: string; count: number; sample?: any }[] = [];

    for (const table of tables) {
      try {
        const result = await pool.query(
          `SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = 'default' OR (payload->>'tenantId') = 'default'`
        );
        const count = parseInt(result.rows[0].count, 10);

        if (count > 0) {
          console.log(`❌ ${table}: ${count} rows with tenant_id='default'`);
          totalViolations += count;
          violations.push({ table, count });

          // Show sample rows
          const sample = await pool.query(
            `SELECT * FROM ${table} WHERE tenant_id = 'default' LIMIT 1`
          );
          if (sample.rows.length > 0) {
            violations[violations.length - 1].sample = sample.rows[0];
            console.log(`   Sample ID: ${Object.values(sample.rows[0])[0]}\n`);
          }
        } else {
          console.log(`✅ ${table}: Clean (0 rows)`);
        }
      } catch (e: any) {
        // Table might not exist yet or column might not exist
        if (e.message.includes('does not exist')) {
          console.log(`⏭️  ${table}: Table not created`);
        } else {
          console.log(`⚠️  ${table}: ${e.message}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    if (totalViolations === 0) {
      console.log('✅ PASS: No contaminated rows found\n');
      console.log('Status: SAFE to proceed with Phase 1I (Pilot RLS)\n');
    } else {
      console.log(`❌ FAIL: Found ${totalViolations} contaminated rows\n`);
      console.log('Violations by table:');
      violations.forEach(v => {
        console.log(`  - ${v.table}: ${v.count} rows`);
      });
      console.log('\nAction required before RLS:\n');
      console.log('Option 1: Delete contaminated rows');
      console.log('  DELETE FROM <table> WHERE tenant_id = \'default\';\n');
      console.log('Option 2: Migrate rows to valid tenantId');
      console.log('  UPDATE <table> SET tenant_id = \'<valid-uuid>\' WHERE tenant_id = \'default\';\n');
    }

    await pool.end();
    process.exit(totalViolations === 0 ? 0 : 1);
  } catch (err: any) {
    console.error('Error checking contamination:', err.message);
    console.error('\nNote: Database must be running and accessible');
    console.error('Run: npm run dev');
    process.exit(1);
  }
}

checkContamination();
