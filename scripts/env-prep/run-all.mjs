/**
 * Orchestrator — full demo-environment preparation
 *
 * Runs: 01 parse → 02 wipe → 03 indexes → 04 HEC → 05 events → 06 KOs →
 *       07 usage → 08 validate
 *
 * Usage:
 *   node scripts/env-prep/run-all.mjs --dry-run     # plan everything, change nothing
 *   node scripts/env-prep/run-all.mjs               # full run
 *   node scripts/env-prep/run-all.mjs --skip-wipe   # additive run (keep existing data)
 *
 * Env: SPLUNK_URL, SPLUNK_USER, SPLUNK_PASSWORD (required)
 *      TOTAL_DAILY_GB, MAX_EVENTS_TOTAL, USAGE_SCALE, ANALYST_PASSWORD, HEC_PORT
 */

import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const skipWipe = process.argv.includes('--skip-wipe');

const steps = [
  '01-parse-csvs.mjs',
  ...(skipWipe ? [] : ['02-wipe.mjs']),
  '03-create-indexes.mjs',
  '04-hec-setup.mjs',
  '05-generate-events.mjs',
  '06-create-knowledge-objects.mjs',
  '07-generate-usage.mjs',
  ...(dryRun ? [] : ['08-validate.mjs']),
];

for (const step of steps) {
  console.log(`\n━━━ ${step} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const args = [join(__dirname, step), ...(dryRun ? ['--dry-run'] : [])];
  const res = spawnSync('node', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\n✗ ${step} failed (exit ${res.status}) — aborting.`);
    process.exit(res.status || 1);
  }
}

console.log('\n✓ Environment preparation complete.');
