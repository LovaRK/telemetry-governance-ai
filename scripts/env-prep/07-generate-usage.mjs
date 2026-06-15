/**
 * 07 — Generate organic _audit usage signals
 *
 * Actually RUNS ad-hoc searches via /services/search/jobs per the adhoc-usage
 * distribution in the manifest. This is the only honest way to produce
 * audit-trail usage (who ran what): _audit cannot be written directly.
 *
 * Optionally creates a second user (`analyst1`) and runs a share of searches
 * as them, so distinct-user counts exceed 1. Both datasensAI (B3) and Data
 * Sensei read these same signals.
 *
 * Usage: node scripts/env-prep/07-generate-usage.mjs [--dry-run]
 * Env:   USAGE_SCALE   fraction of source adhoc counts to replay (default 0.05)
 *        ANALYST_PASSWORD  password for the created analyst1 user
 *                          (required unless --dry-run; never hardcoded)
 */

import { SplunkRest, loadManifest, splunkConfig, DRY_RUN, log } from './00-lib.mjs';

const USAGE_SCALE = parseFloat(process.env.USAGE_SCALE || '0.05');
const MAX_SEARCHES_PER_INDEX = 20;
// Every index gets at least this many ad-hoc searches: in any real environment
// someone occasionally searches each index, and it gives the _audit-based
// utilization signals (B3) something to measure everywhere.
const FLOOR_SEARCHES_PER_INDEX = parseInt(process.env.USAGE_FLOOR || '2', 10);

async function main() {
  const manifest = loadManifest();
  const rest = new SplunkRest();

  const plan = manifest.indexes
    .map(idx => ({
      index: idx.name,
      sourcetype: idx.sourcetypes[0]?.sourcetype,
      searches: Math.min(
        MAX_SEARCHES_PER_INDEX,
        Math.max(FLOOR_SEARCHES_PER_INDEX, Math.round(idx.usage.adHocSearchCount * USAGE_SCALE))
      ),
    }))
    .filter(p => p.searches > 0);

  const total = plan.reduce((n, p) => n + p.searches, 0);
  log(`Usage generation ${DRY_RUN ? '(DRY RUN)' : ''}: ${total} ad-hoc searches across ${plan.length} indexes (scale ×${USAGE_SCALE})`);
  if (DRY_RUN) {
    plan.forEach(p => log(`  ${p.index}: ${p.searches} searches`));
    return;
  }

  // Create a second user so distinct-user counts are > 1
  const analystPassword = process.env.ANALYST_PASSWORD;
  let analystRest = null;
  if (analystPassword) {
    await rest.post('/services/authentication/users', {
      name: 'analyst1', password: analystPassword, roles: 'user',
    }, [409]);
    const cfg = splunkConfig();
    analystRest = new SplunkRest({ url: cfg.url, user: 'analyst1', password: analystPassword });
    log('  user analyst1: ready');
  } else {
    log('  ANALYST_PASSWORD not set — all searches run as admin (distinct users = 1)');
  }

  let run = 0;
  for (const p of plan) {
    for (let i = 0; i < p.searches; i++) {
      const client = analystRest && i % 3 === 1 ? analystRest : rest;
      const spl = i % 2 === 0
        ? `index=${p.index} | head 5`
        : `index=${p.index} sourcetype="${p.sourcetype}" | stats count by host | head 5`;
      try {
        await client.search(spl, { earliest: '-24h', latest: 'now', timeoutMs: 60000 });
        run++;
      } catch (e) {
        log(`  warn: search on ${p.index} failed: ${e.message.slice(0, 80)}`);
      }
    }
    log(`  ${p.index}: ${p.searches} searches executed`);
  }

  log(`\n✓ ${run}/${total} ad-hoc searches executed → _audit now carries organic usage signals.`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
