/**
 * 02 — Wipe demo data from the target Splunk instance
 *
 * Deletes:
 *   - the dedicated app `datasense_demo` (all KOs created by this tooling)
 *   - custom indexes listed in the manifest
 *   - extra legacy/dummy indexes ONLY when passed via --include a,b,c
 *
 * Never touches `_*` system indexes or built-ins (main/history/summary/...).
 *
 * Usage:
 *   node scripts/env-prep/02-wipe.mjs --dry-run
 *   node scripts/env-prep/02-wipe.mjs
 *   node scripts/env-prep/02-wipe.mjs --include old_dummy_idx1,old_dummy_idx2
 */

import { SplunkRest, loadManifest, DRY_RUN, log } from './00-lib.mjs';

const BUILTIN = new Set(['main', 'history', 'summary', 'lastchanceindex', 'lastchangeindex', 'splunklogger']);

function includeArg() {
  const i = process.argv.indexOf('--include');
  if (i === -1) return [];
  return (process.argv[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function main() {
  const manifest = loadManifest();
  const rest = new SplunkRest();
  const manifestIndexes = new Set(manifest.indexes.map(i => i.name));
  const extra = includeArg();

  // Current live indexes
  const live = await rest.get('/services/data/indexes?count=500');
  const liveNames = (live.entry || []).map(e => e.name);

  const deletable = liveNames.filter(n =>
    !n.startsWith('_') && !BUILTIN.has(n) && (manifestIndexes.has(n) || extra.includes(n))
  );
  const skipped = liveNames.filter(n => !deletable.includes(n));

  log(`Wipe plan ${DRY_RUN ? '(DRY RUN)' : ''}`);
  log(`  app to delete:      ${manifest.app}`);
  log(`  indexes to delete:  ${deletable.length ? deletable.join(', ') : '(none)'}`);
  log(`  indexes untouched:  ${skipped.join(', ')}`);
  if (extra.length) log(`  --include extras:   ${extra.join(', ')}`);

  if (DRY_RUN) { log('\nDry run complete.'); return; }

  // Delete the demo app (removes its saved searches, dashboards, macros, eventtypes, tags)
  const appStatus = await rest.delete(`/services/apps/local/${manifest.app}`, [404]);
  log(appStatus === 404 ? `  app ${manifest.app}: not present` : `  app ${manifest.app}: deleted`);

  for (const idx of deletable) {
    await rest.delete(`/services/data/indexes/${encodeURIComponent(idx)}`);
    log(`  index ${idx}: deleted`);
  }

  log(`\n✓ Wipe complete (${deletable.length} indexes + app).`);
  log('  Note: Splunk may take a minute to fully remove index directories.');
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
