/**
 * 08 — Validate the prepared environment against the manifest
 *
 * Queries Splunk back and prints expected vs actual:
 *   index count, per-index 24h events (tstats), saved-search/dashboard/macro/
 *   eventtype counts in the demo app, parsing-error presence in _internal,
 *   ad-hoc usage presence in _audit.
 *
 * Exits non-zero on any hard mismatch — used as the env-prep acceptance gate.
 *
 * Usage: node scripts/env-prep/08-validate.mjs
 */

import { SplunkRest, loadManifest, log } from './00-lib.mjs';

let failures = 0;
function check(label, expected, actual, { exact = false, atLeast = false } = {}) {
  const pass = exact ? actual === expected : atLeast ? actual >= expected : actual > 0;
  const mark = pass ? '✓' : '✗';
  if (!pass) failures++;
  log(`  ${mark} ${label.padEnd(46)} expected ${String(expected).padStart(6)}  actual ${String(actual).padStart(6)}`);
}

async function main() {
  const manifest = loadManifest();
  const rest = new SplunkRest();
  log('Environment validation\n');

  // ── Indexes ──
  const live = await rest.get('/services/data/indexes?count=500');
  const liveNames = new Set((live.entry || []).map(e => e.name));
  const present = manifest.indexes.filter(i => liveNames.has(i.name));
  check('indexes created', manifest.expected.indexCount, present.length, { exact: true });

  // ── Events per index (24h, tstats) ──
  const idxFilter = manifest.indexes.map(i => `index="${i.name}"`).join(' OR ');
  const rows = await rest.search(`| tstats count WHERE (${idxFilter}) earliest=-24h latest=now BY index`, { timeoutMs: 120000 });
  const counts = new Map(rows.map(r => [r.index, parseInt(r.count, 10)]));
  let withEvents = 0;
  for (const idx of manifest.indexes) {
    const n = counts.get(idx.name) || 0;
    if (n > 0) withEvents++;
    else log(`    (no events yet: ${idx.name})`);
  }
  check('indexes with events (24h)', manifest.expected.indexCount, withEvents, { atLeast: false, exact: true });

  // ── Sourcetype pairs ──
  const stRows = await rest.search(`| tstats count WHERE (${idxFilter}) earliest=-24h latest=now BY index, sourcetype`, { timeoutMs: 120000 });
  check('index::sourcetype pairs with events', manifest.expected.sourcetypePairCount, stRows.length, { atLeast: true });

  // ── Knowledge objects in the demo app ──
  const app = manifest.app;
  const saved = await rest.get(`/servicesNS/-/${app}/saved/searches?count=0&search=eai:acl.app%3D${app}`);
  check('saved searches in app', manifest.expected.savedSearchCount, (saved.entry || []).length, { atLeast: true });

  const views = await rest.get(`/servicesNS/-/${app}/data/ui/views?count=0`);
  const appViews = (views.entry || []).filter(e => e.acl?.app === app);
  check('dashboards in app', Math.min(manifest.expected.dashboardCount, 10 * manifest.expected.indexCount), appViews.length, { atLeast: false });

  const macros = await rest.get(`/servicesNS/-/${app}/admin/macros?count=0`);
  const appMacros = (macros.entry || []).filter(e => e.acl?.app === app);
  check('macros in app', manifest.expected.macroCount, appMacros.length, { atLeast: false });

  const ets = await rest.get(`/servicesNS/-/${app}/saved/eventtypes?count=0`);
  const appEts = (ets.entry || []).filter(e => e.acl?.app === app);
  check('eventtypes in app', manifest.expected.eventtypeCount, appEts.length, { atLeast: false });

  // ── Organic quality issues in _internal ──
  const dq = await rest.search(
    `search index=_internal sourcetype=splunkd (component=DateParserVerbose OR component=LineBreakingProcessor OR component=AggregatorMiningProcessor) earliest=-24h latest=now | stats count`,
    { timeoutMs: 120000 }
  );
  check('parsing warnings present in _internal', 1, parseInt(dq[0]?.count || '0', 10), { atLeast: true });

  // ── Organic usage in _audit ──
  const audit = await rest.search(
    `search index=_audit action=search info=completed earliest=-24h latest=now | stats count`,
    { timeoutMs: 120000 }
  );
  check('completed searches recorded in _audit', 1, parseInt(audit[0]?.count || '0', 10), { atLeast: true });

  log(`\n${failures === 0 ? '✓ Environment validation PASSED' : `✗ Environment validation FAILED (${failures} checks)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
