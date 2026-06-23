/**
 * 05b — Upload 1stmile volume CSV as a Splunk lookup
 *
 * This step uploads `1stmile_index_sourcetype_and_source_volume_lookupcsv`
 * to dev Splunk so that datasensAI can query it via:
 *
 *   | inputlookup 1stmile_index_sourcetype_and_source_volume_lookupcsv
 *   | stats sum(GB_idx_st_s) as raw_gb by index
 *
 * The splunk-client then normalises the raw CSV GB values to the Teja-confirmed
 * logical daily ingest baseline (92 GB/day), giving the dashboard accurate KPIs
 * and ROI/savings numbers without requiring 92 GB of physical data in dev Splunk.
 *
 * Lookup is uploaded to the `search` app (always exists), so it is visible to
 * all searches regardless of which app datasensAI's queries run under.
 *
 * Usage:
 *   node scripts/env-prep/05b-upload-lookups.mjs --dry-run
 *   node scripts/env-prep/05b-upload-lookups.mjs
 *
 * Env: SPLUNK_URL, SPLUNK_USER, SPLUNK_PASSWORD (required)
 */

import { readFileSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join } from 'path';
import https from 'https';
import http from 'http';
import { splunkConfig, SEED_DIR, DRY_RUN, log } from './00-lib.mjs';

const LOOKUP_NAME = '1stmile_index_sourcetype_and_source_volume_lookupcsv';
const APP = 'search'; // always exists; lookup visible to all search contexts

function readVolumeCSV() {
  const gz = join(SEED_DIR, `${LOOKUP_NAME}.csv.gz`);
  const plain = join(SEED_DIR, `${LOOKUP_NAME}.csv`);
  if (existsSync(gz)) return gunzipSync(readFileSync(gz)).toString('utf-8');
  if (existsSync(plain)) return readFileSync(plain, 'utf-8');
  throw new Error(`Seed file not found: ${plain}[.gz]`);
}

function multipartPost(targetUrl, auth, csvContent, filename) {
  return new Promise((resolve, reject) => {
    const boundary = `SplunkLookupBoundary${Date.now()}`;
    const fileBuf = Buffer.from(csvContent, 'utf-8');

    const parts = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${filename}\r\n`
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="eai:data"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`
      ),
      fileBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    const body = Buffer.concat(parts);

    const u = new URL(targetUrl);
    const client = u.protocol === 'https:' ? https : http;

    const req = client.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + '?output_mode=json',
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        rejectUnauthorized: false,
        timeout: 60000,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('upload timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function registerTransform(baseUrl, auth, app, filename) {
  // Register a transforms.conf stanza so `| inputlookup` resolves the file.
  const body = new URLSearchParams({
    name: LOOKUP_NAME,
    filename,
    type: 'csv',
  }).toString();
  const u = `${baseUrl}/servicesNS/nobody/${app}/data/transforms/lookups?output_mode=json`;
  const client = u.startsWith('https') ? https : http;

  return new Promise((resolve, reject) => {
    const url = new URL(u);
    const req = (u.startsWith('https') ? https : http).request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        rejectUnauthorized: false,
        timeout: 30000,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 409, text })
        );
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const cfg = splunkConfig();
  const auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');

  log(`05b — Upload customer profile lookup ${DRY_RUN ? '(DRY RUN)' : ''}`);
  log(`  lookup: ${LOOKUP_NAME}`);
  log(`  app:    ${APP}`);
  log(`  target: ${cfg.url}`);

  const csvContent = readVolumeCSV();
  const rowCount = (csvContent.match(/\n/g) || []).length;
  log(`  rows:   ${rowCount} (including header)`);

  if (DRY_RUN) {
    log('\n  [dry-run] Would upload CSV and register transforms.conf stanza.');
    log('  Dashboard will then show ~92 GB/day instead of physical dev volume.');
    log('\nDry run complete.');
    return;
  }

  // Upload the file
  const filename = `${LOOKUP_NAME}.csv`;
  const uploadUrl = `${cfg.url}/servicesNS/nobody/${APP}/data/lookup-table-files`;
  log(`  Uploading lookup file…`);
  const uploadRes = await multipartPost(uploadUrl, auth, csvContent, filename);

  if (!uploadRes.ok && uploadRes.status !== 409) {
    // 409 = already exists — treat as success (idempotent)
    throw new Error(`Lookup upload failed (HTTP ${uploadRes.status}): ${uploadRes.text.slice(0, 300)}`);
  }
  log(`  Upload: HTTP ${uploadRes.status} ${uploadRes.status === 409 ? '(already exists — OK)' : '✓'}`);

  // Register the transforms.conf stanza
  log(`  Registering transforms.conf stanza…`);
  const regRes = await registerTransform(cfg.url, auth, APP, filename);
  log(`  Register: HTTP ${regRes.status} ${regRes.status === 409 ? '(already exists — OK)' : '✓'}`);

  log(`\n✓ Lookup uploaded. datasensAI will now read logical 1stmile ingest profile`);
  log(`  (92 GB/day normalised from ${LOOKUP_NAME})`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
