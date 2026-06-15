/**
 * 03 — Create indexes per the manifest
 *
 * POST /services/data/indexes with frozenTimePeriodInSecs from the
 * metadata CSV (preserves the retention signal used by retention analytics).
 *
 * Usage: node scripts/env-prep/03-create-indexes.mjs [--dry-run]
 */

import { SplunkRest, loadManifest, DRY_RUN, log } from './00-lib.mjs';

async function main() {
  const manifest = loadManifest();
  const rest = new SplunkRest();

  log(`Creating ${manifest.indexes.length} indexes ${DRY_RUN ? '(DRY RUN)' : ''}`);
  for (const idx of manifest.indexes) {
    if (DRY_RUN) {
      log(`  would create: ${idx.name} (retention ${Math.round(idx.frozenTimePeriodInSecs / 86400)}d)`);
      continue;
    }
    const { status } = await rest.post('/services/data/indexes', {
      name: idx.name,
      frozenTimePeriodInSecs: String(idx.frozenTimePeriodInSecs),
    }, [409]); // 409 = already exists
    log(`  ${idx.name}: ${status === 409 ? 'already exists' : 'created'}`);
  }
  log('\n✓ Index creation complete.');
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
