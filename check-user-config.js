const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
});

async function main() {
  try {
    const resColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_config'
    `);
    console.log('=== user_config columns ===');
    resColumns.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));

    const resRows = await pool.query(`
      SELECT * FROM user_config
    `);
    console.log('\n=== user_config rows ===');
    console.log(resRows.rows);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
main();
