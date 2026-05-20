import { query } from '@core/database/connection';

async function checkState() {
  try {
    const jobResult = await query(`
      SELECT id, job_id, job_type, status, created_at, started_at, completed_at 
      FROM job_queue 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('\n=== job_queue (latest 5) ===');
    console.log(JSON.stringify(jobResult.rows, null, 2));

    const queueCount = await query(`
      SELECT COUNT(*) as count FROM queue_health_metrics 
      WHERE snapshot_date = CURRENT_DATE
    `);
    console.log('\n=== queue_health_metrics (today) ===');
    console.log(`Count: ${queueCount.rows[0].count}`);

    const kpiCount = await query(`
      SELECT COUNT(*) as count FROM executive_kpis 
      WHERE snapshot_date = CURRENT_DATE
    `);
    console.log('\n=== executive_kpis (today) ===');
    console.log(`Count: ${kpiCount.rows[0].count}`);

    const telCount = await query(`
      SELECT COUNT(*) as count FROM telemetry_snapshots 
      WHERE snapshot_date = CURRENT_DATE
    `);
    console.log('\n=== telemetry_snapshots (today) ===');
    console.log(`Count: ${telCount.rows[0].count}`);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkState();
