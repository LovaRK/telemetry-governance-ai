import { query } from './core/database/connection';

async function verify() {
  try {
    console.log('\n========== PIPELINE EXECUTION VERIFICATION ==========\n');

    const jobResult = await query<any>(`
      SELECT id, job_id, job_type, status, created_at, started_at, completed_at
      FROM job_queue
      WHERE job_id = '94192da5-a468-44ad-a437-4ae0d2fd3d3e'
    `);

    if (jobResult.rows.length === 0) {
      console.log('✗ Job not found in job_queue');
      process.exit(1);
    }

    const job = jobResult.rows[0];
    console.log('✓ Job found in job_queue:');
    console.log(`  - Job ID: ${job.job_id}`);
    console.log(`  - Type: ${job.job_type}`);
    console.log(`  - Status: ${job.status}`);
    console.log(`  - Started: ${job.started_at}`);
    console.log(`  - Completed: ${job.completed_at}`);

    const today = new Date().toISOString().split('T')[0];

    const queueMetrics = await query<any>(`
      SELECT COUNT(*) as count, snapshot_date
      FROM queue_health_metrics
      WHERE snapshot_date = $1
      GROUP BY snapshot_date
    `, [today]);

    console.log(`\n✓ queue_health_metrics populated:`);
    console.log(`  - Count (today): ${queueMetrics.rows[0]?.count || 0}`);

    if (queueMetrics.rows[0]?.count > 0) {
      const sample = await query<any>(`
        SELECT queue_depth, processing_time_p95_ms, decision_flip_rate, filtering_efficiency_pct
        FROM queue_health_metrics
        WHERE snapshot_date = $1
        LIMIT 1
      `, [today]);
      const row = sample.rows[0];
      console.log(`  - Sample metrics: queue_depth=${row.queue_depth}, p95=${row.processing_time_p95_ms}ms, flip_rate=${row.decision_flip_rate}, efficiency=${row.filtering_efficiency_pct}%`);
    }

    const kpiMetrics = await query<any>(`
      SELECT COUNT(*) as count, snapshot_date
      FROM executive_kpis
      WHERE snapshot_date = $1
      GROUP BY snapshot_date
    `, [today]);

    console.log(`\n✓ executive_kpis populated:`);
    console.log(`  - Count (today): ${kpiMetrics.rows[0]?.count || 0}`);

    if (kpiMetrics.rows[0]?.count > 0) {
      const sample = await query<any>(`
        SELECT roi_score, gainscope_score, tier_critical, tier_important, tier_nice_to_have, tier_low_value
        FROM executive_kpis
        WHERE snapshot_date = $1
        LIMIT 1
      `, [today]);
      const row = sample.rows[0];
      console.log(`  - Sample metrics: roi=${row.roi_score}, gainscope=${row.gainscope_score}, tiers=[crit:${row.tier_critical} imp:${row.tier_important} nice:${row.tier_nice_to_have} low:${row.tier_low_value}]`);
    }

    const telemetry = await query<any>(`
      SELECT COUNT(*) as count, snapshot_date
      FROM telemetry_snapshots
      WHERE snapshot_date = $1
      GROUP BY snapshot_date
    `, [today]);

    console.log(`\n✓ telemetry_snapshots seeded:`);
    console.log(`  - Count (today): ${telemetry.rows[0]?.count || 0}`);

    if (telemetry.rows[0]?.count > 0) {
      const samples = await query<any>(`
        SELECT index_name, utilization_pct, classification, confidence
        FROM telemetry_snapshots
        WHERE snapshot_date = $1
        ORDER BY index_name
      `, [today]);
      console.log(`  - Sample indexes:`);
      samples.rows.forEach(row => {
        console.log(`    - ${row.index_name}: utilization=${row.utilization_pct}%, class=${row.classification}, confidence=${row.confidence}`);
      });
    }

    console.log('\n========== VERDICT ==========');
    if (job.status === 'complete' &&
        queueMetrics.rows[0]?.count > 0 &&
        kpiMetrics.rows[0]?.count > 0 &&
        telemetry.rows[0]?.count > 0) {
      console.log('✅ PIPELINE END-TO-END VALIDATION: PASSED');
      console.log('\nAll stages executed successfully:');
      console.log('  ✓ Job claimed from queue');
      console.log('  ✓ Queue health metrics populated');
      console.log('  ✓ Executive KPIs populated');
      console.log('  ✓ Telemetry snapshots seeded');
      console.log('  ✓ Job marked complete');
    } else {
      console.log('❌ PIPELINE VALIDATION: FAILED');
      console.log('Not all data was populated:');
      console.log(`  Job status: ${job.status === 'complete' ? '✓' : '✗'}`);
      console.log(`  Queue metrics: ${queueMetrics.rows[0]?.count > 0 ? '✓' : '✗'}`);
      console.log(`  KPI metrics: ${kpiMetrics.rows[0]?.count > 0 ? '✓' : '✗'}`);
      console.log(`  Telemetry: ${telemetry.rows[0]?.count > 0 ? '✓' : '✗'}`);
    }

    console.log('\n');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

verify();
