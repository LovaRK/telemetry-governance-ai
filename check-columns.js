const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
});

async function main() {
  try {
    const resColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'job_queue'
    `);
    console.log('=== job_queue columns ===');
    resColumns.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));

    const resMigrations = await pool.query(`
      SELECT name, checksum, status FROM applied_migrations ORDER BY name
    `);
    console.log('\n=== applied migrations ===');
    resMigrations.rows.forEach(r => console.log(`${r.name}: ${r.status}`));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
main();
