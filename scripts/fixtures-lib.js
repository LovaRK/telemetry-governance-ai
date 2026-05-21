const crypto = require('crypto');
const { Pool } = require('pg');

const DEFAULT_DB = 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os';
const FIXTURE_PREFIX = 'fixture_test_';

function getPool() {
  const connectionString = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || DEFAULT_DB;
  return new Pool({ connectionString });
}

function getRunId() {
  return (
    process.env.TEST_RUN_ID ||
    process.env.FIXTURE_RUN_ID ||
    `run_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  );
}

function getFixtureTag(runId) {
  return `${FIXTURE_PREFIX}${runId}`;
}

function getFixtureDate(runId) {
  const digest = crypto.createHash('sha1').update(runId).digest('hex');
  const day = (parseInt(digest.slice(0, 2), 16) % 28) + 1;
  return `2099-12-${String(day).padStart(2, '0')}`;
}

module.exports = {
  DEFAULT_DB,
  FIXTURE_PREFIX,
  getPool,
  getRunId,
  getFixtureTag,
  getFixtureDate,
};
