const { getPool, FIXTURE_PREFIX } = require('./fixtures-lib');

async function count(client, query, params) {
  const r = await client.query(query, params);
  return Number(r.rows[0]?.count || 0);
}

async function main() {
  const pool = getPool();
  const likeValue = `${FIXTURE_PREFIX}%`;
  const client = await pool.connect();

  try {
    const telemetrySnapshots = await count(
      client,
      `SELECT COUNT(*)::int AS count
       FROM telemetry_snapshots
       WHERE index_name LIKE $1
          OR sourcetype LIKE $1
          OR recommendation ILIKE $2
          OR (raw_metadata ->> 'created_by') = 'test'`,
      [likeValue, `%${FIXTURE_PREFIX}%`]
    );

    const agentDecisions = await count(
      client,
      `SELECT COUNT(*)::int AS count
       FROM agent_decisions
       WHERE index_name LIKE $1
          OR sourcetype LIKE $1
          OR recommendation ILIKE $2
          OR reasoning ILIKE $2`,
      [likeValue, `%${FIXTURE_PREFIX}%`]
    );

    const executiveKpis = await count(
      client,
      `SELECT COUNT(*)::int AS count
       FROM executive_kpis
       WHERE snapshot_date >= DATE '2099-12-01'
          OR agent_reasoning ILIKE $1`,
      [`%${FIXTURE_PREFIX}%`]
    );

    const summary = {
      telemetry_snapshots: telemetrySnapshots,
      agent_decisions: agentDecisions,
      executive_kpis: executiveKpis,
    };

    const total = telemetrySnapshots + agentDecisions + executiveKpis;

    console.log(JSON.stringify({ ok: total === 0, summary }, null, 2));

    if (total !== 0) {
      console.error('[verify-clean] fixture residue detected');
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[verify-clean] failed:', error.message);
  process.exit(1);
});
