const crypto = require('crypto');
const {
  getPool,
  getRunId,
  getFixtureTag,
  getFixtureDate,
} = require('./fixtures-lib');

async function main() {
  const pool = getPool();
  const runId = getRunId();
  const fixtureTag = getFixtureTag(runId);
  const snapshotId = crypto.randomUUID();
  const snapshotDate = getFixtureDate(runId);
  const indexName = `${fixtureTag}_index`;
  const sourcetype = `${fixtureTag}_sourcetype`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO telemetry_snapshots (
        snapshot_id, snapshot_date, granularity, parent_index, index_name, sourcetype,
        total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year,
        risk_score, classification, confidence, recommendation, evidence, raw_metadata
      ) VALUES (
        $1, $2::date, 'sourcetype', $3, $4, $5,
        0, 1.25, 30, 0.10, 1200,
        25, 'ARCHIVE', 0.91, $6, '[]'::jsonb,
        jsonb_build_object(
          'created_by', 'test',
          'fixture_tag', $7::text,
          'test_run_id', $8::text,
          'expires_at', to_char(NOW() + INTERVAL '1 hour', 'YYYY-MM-DD\"T\"HH24:MI:SSOF')
        )
      )
      ON CONFLICT DO NOTHING`,
      [snapshotId, snapshotDate, indexName, indexName, sourcetype, `fixture recommendation ${fixtureTag}`, fixtureTag, runId]
    );

    await client.query(
      `INSERT INTO executive_kpis (
        snapshot_id, snapshot_date, roi_score, gainscope_score,
        total_license_spend, license_spend_low_value, storage_savings_potential,
        total_daily_gb, total_sourcetypes, tier_critical, tier_important,
        tier_nice_to_have, tier_low_value, security_gaps, operational_gaps,
        avg_utilization, avg_detection, avg_quality, avg_confidence,
        quick_wins, savings_staircase, agent_reasoning
      ) VALUES (
        $1, $2::date, 66.5, 72.0,
        2000, 1500, 1200,
        1.25, 1, 0, 0,
        0, 1, 0, 0,
        0.10, 0.20, 0.50, 0.91,
        '[]'::jsonb, '[]'::jsonb, $3
      )
      ON CONFLICT (snapshot_date) DO NOTHING`,
      [snapshotId, snapshotDate, `fixture reasoning ${fixtureTag}`]
    );

    await client.query(
      `INSERT INTO agent_decisions (
        snapshot_id, snapshot_date, index_name, sourcetype,
        tier, action, composite_score, utilization_score, detection_score,
        quality_score, risk_score, annual_license_cost, estimated_savings,
        confidence, confidence_score, recommendation, reasoning, evidence,
        is_quick_win, is_s3_candidate, detection_gap
      ) VALUES (
        $1, $2::date, $3, $4,
        'LOW_VALUE', 'ARCHIVE', 82.3, 0.10, 0.20,
        0.50, 25.0, 1200, 1000,
        0.91, 91.0, $5, $6, '[]'::jsonb,
        true, true, false
      )
      ON CONFLICT DO NOTHING`,
      [snapshotId, snapshotDate, indexName, sourcetype, `remove ${fixtureTag}`, `fixture decision ${fixtureTag}`]
    );

    await client.query('COMMIT');

    console.log(JSON.stringify({
      ok: true,
      runId,
      fixtureTag,
      snapshotId,
      snapshotDate,
      indexName,
      sourcetype,
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
  console.error('[seed-fixtures] failed:', error.message);
  process.exit(1);
});
