/**
 * 04 — HEC setup with automatic fallback detection
 *
 * Enables the HTTP Event Collector and creates a `datasense_demo` token.
 * Then probes the HEC port (8088). If unreachable (firewalled), records
 * transport=rest in the manifest so 05-generate-events uses
 * /services/receivers/simple over the management port instead.
 *
 * Usage: node scripts/env-prep/04-hec-setup.mjs [--dry-run]
 * Env:   HEC_PORT (default 8088)
 */

import { SplunkRest, SplunkHec, loadManifest, saveManifest, splunkConfig, DRY_RUN, log } from './00-lib.mjs';

const HEC_PORT = process.env.HEC_PORT || '8088';

async function main() {
  const manifest = loadManifest();
  const rest = new SplunkRest();

  if (DRY_RUN) {
    log('(DRY RUN) Would enable HEC, create token datasense_demo, probe port ' + HEC_PORT);
    return;
  }

  // 1. Enable HEC globally (settings stanza lives under splunk_httpinput)
  await rest.post('/servicesNS/nobody/splunk_httpinput/data/inputs/http/http', {
    disabled: '0', enableSSL: '1',
  }, [409, 400, 404]).catch(() => log('  (global HEC enable not supported on this version — continuing)'));

  // 2. Create (or fetch) the token
  const { status } = await rest.post('/servicesNS/nobody/splunk_httpinput/data/inputs/http', {
    name: 'datasense_demo',
    index: manifest.indexes[0]?.name || 'main',
    indexes: manifest.indexes.map(i => i.name).join(','),
  }, [409]);
  log(`  HEC token datasense_demo: ${status === 409 ? 'already exists' : 'created'}`);

  const tokenInfo = await rest.get('/servicesNS/nobody/splunk_httpinput/data/inputs/http/datasense_demo');
  const token = tokenInfo?.entry?.[0]?.content?.token;
  if (!token) throw new Error('Could not read back HEC token value');

  // 3. Probe the HEC port with a no-op event
  const cfg = splunkConfig();
  const host = new URL(cfg.url).hostname;
  const hecUrl = `https://${host}:${HEC_PORT}`;
  let transport = 'hec';
  try {
    const hec = new SplunkHec(hecUrl, token);
    await hec.send([{ event: 'datasense_demo hec probe', index: manifest.indexes[0]?.name || 'main', sourcetype: 'hec:probe' }]);
    log(`  HEC reachable at ${hecUrl} ✓`);
  } catch (e) {
    transport = 'rest';
    log(`  HEC port ${HEC_PORT} unreachable (${e.message.slice(0, 80)})`);
    log('  → falling back to /services/receivers/simple over the management port');
  }

  manifest.ingest = { transport, hecUrl, hecToken: transport === 'hec' ? token : null };
  saveManifest(manifest);
  log(`\n✓ Ingest transport: ${transport}`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
