const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
});

(async () => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('Tables in database:');
    result.rows.forEach(r => console.log('  -', r.table_name));
  } finally {
    client.release();
    pool.end();
  }
})();
