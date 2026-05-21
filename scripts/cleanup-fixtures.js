const { getPool, getRunId, getFixtureTag, FIXTURE_PREFIX } = require('./fixtures-lib');

async function main() {
  const pool = getPool();
  const runId = process.env.TEST_RUN_ID || process.env.FIXTURE_RUN_ID || null;
  const fixtureTag = runId ? getFixtureTag(runId) : null;

  const likeValue = `${FIXTURE_PREFIX}%`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const decisionDelete = fixtureTag
      ? await client.query(
          `DELETE FROM agent_decisions
           WHERE index_name LIKE $1 OR sourcetype LIKE $1 OR recommendation ILIKE $2 OR reasoning ILIKE $2`,
          [likeValue, `%${fixtureTag}%`]
        )
      : await client.query(
          `DELETE FROM agent_decisions
           WHERE index_name LIKE $1 OR sourcetype LIKE $1 OR recommendation ILIKE $2 OR reasoning ILIKE $2`,
          [likeValue, `%${FIXTURE_PREFIX}%`]
        );

    const snapshotDelete = fixtureTag
      ? await client.query(
          `DELETE FROM telemetry_snapshots
           WHERE index_name LIKE $1 OR sourcetype LIKE $1
             OR recommendation ILIKE $2
             OR (raw_metadata ->> 'fixture_tag') = $3
             OR (raw_metadata ->> 'created_by') = 'test'`,
          [likeValue, `%${fixtureTag}%`, fixtureTag]
        )
      : await client.query(
          `DELETE FROM telemetry_snapshots
           WHERE index_name LIKE $1 OR sourcetype LIKE $1
             OR recommendation ILIKE $2
             OR (raw_metadata ->> 'created_by') = 'test'`,
          [likeValue, `%${FIXTURE_PREFIX}%`]
        );

    const kpiDelete = fixtureTag
      ? await client.query(
          `DELETE FROM executive_kpis
           WHERE snapshot_date >= DATE '2099-12-01' OR agent_reasoning ILIKE $1`,
          [`%${fixtureTag}%`]
        )
      : await client.query(
          `DELETE FROM executive_kpis
           WHERE snapshot_date >= DATE '2099-12-01' OR agent_reasoning ILIKE $1`,
          [`%${FIXTURE_PREFIX}%`]
        );

    await client.query('COMMIT');

    console.log(JSON.stringify({
      ok: true,
      runId,
      fixtureTag,
      deleted: {
        agent_decisions: decisionDelete.rowCount,
        telemetry_snapshots: snapshotDelete.rowCount,
        executive_kpis: kpiDelete.rowCount,
      },
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[cleanup-fixtures] failed:', error.message);
  process.exit(1);
});
