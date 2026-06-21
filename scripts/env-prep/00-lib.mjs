/**
 * env-prep shared library
 *
 * - RFC-4180 CSV parser (quoted fields, embedded commas/newlines)
 * - Gzip-aware seed file reader
 * - Splunk REST helper (basic auth, insecure TLS for self-signed demo certs)
 * - Manifest load/save
 *
 * Env:
 *   SPLUNK_URL      e.g. https://144.202.48.85:8089   (management port)
 *   SPLUNK_USER     admin username
 *   SPLUNK_PASSWORD admin password
 *   SEED_DATA_DIR   default: <repo>/seed-data
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { gunzipSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, '..', '..');
export const SEED_DIR = process.env.SEED_DATA_DIR || join(REPO_ROOT, 'seed-data');
export const MANIFEST_PATH = join(__dirname, 'manifest.json');

export const DRY_RUN = process.argv.includes('--dry-run');

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC-4180 CSV parse: returns array of objects keyed by header row. */
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  const header = rows.shift() || [];
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** Read a seed CSV; transparently handles .csv.gz. */
export function readSeedCsv(baseName) {
  const gz = join(SEED_DIR, `${baseName}.gz`);
  const plain = join(SEED_DIR, baseName);
  if (existsSync(gz)) return parseCsv(gunzipSync(readFileSync(gz)).toString('utf-8'));
  if (existsSync(plain)) return parseCsv(readFileSync(plain, 'utf-8'));
  throw new Error(`Seed file not found: ${plain}[.gz] — set SEED_DATA_DIR or add the file.`);
}

// ── Manifest ─────────────────────────────────────────────────────────────────

export function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error('manifest.json not found — run 01-parse-csvs.mjs first.');
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

export function saveManifest(manifest) {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ── Splunk REST ──────────────────────────────────────────────────────────────

export function splunkConfig() {
  const url = process.env.SPLUNK_URL;
  const user = process.env.SPLUNK_USER;
  const password = process.env.SPLUNK_PASSWORD;
  if (!url || !user || !password) {
    throw new Error('Set SPLUNK_URL, SPLUNK_USER, SPLUNK_PASSWORD env vars (never hardcode credentials).');
  }
  return { url: url.replace(/\/$/, ''), user, password };
}

function rawRequest(targetUrl, method, headers, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        timeout: timeoutMs,
        rejectUnauthorized: false, // demo instance uses a self-signed cert
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, text }));
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export class SplunkRest {
  constructor(cfg = splunkConfig()) {
    this.base = cfg.url;
    this.auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  }

  async get(path) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await rawRequest(`${this.base}${path}${sep}output_mode=json`, 'GET', { Authorization: this.auth });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    return JSON.parse(res.text);
  }

  /** POST form-encoded. `okStatuses` lets callers tolerate e.g. 409 already-exists. */
  async post(path, params, okStatuses = []) {
    const sep = path.includes('?') ? '&' : '?';
    const body = new URLSearchParams(params).toString();
    const res = await rawRequest(`${this.base}${path}${sep}output_mode=json`, 'POST', {
      Authorization: this.auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    }, body);
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new Error(`POST ${path} → HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    }
    return { status: res.status, body: res.text ? safeJson(res.text) : null };
  }

  async delete(path, okStatuses = [404]) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await rawRequest(`${this.base}${path}${sep}output_mode=json`, 'DELETE', { Authorization: this.auth });
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new Error(`DELETE ${path} → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    return res.status;
  }

  /** Oneshot search; returns result rows. */
  async search(spl, { earliest = '-24h', latest = 'now', timeoutMs = 120000 } = {}) {
    const body = new URLSearchParams({
      search: spl.startsWith('|') || spl.startsWith('search ') ? spl : `search ${spl}`,
      output_mode: 'json',
      exec_mode: 'oneshot',
      earliest_time: earliest,
      latest_time: latest,
    }).toString();
    const res = await rawRequest(`${this.base}/services/search/jobs`, 'POST', {
      Authorization: this.auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    }, body, timeoutMs);
    if (!res.ok) throw new Error(`search failed → HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    const parsed = safeJson(res.text);
    return parsed?.results || [];
  }

  /** Send raw events via the simple receiver (management port — no HEC needed). */
  async receiveSimple(index, sourcetype, source, rawLines) {
    const q = new URLSearchParams({ index, sourcetype, source }).toString();
    const res = await rawRequest(`${this.base}/services/receivers/simple?${q}`, 'POST', {
      Authorization: this.auth,
      'Content-Type': 'text/plain',
    }, rawLines);
    if (!res.ok) throw new Error(`receivers/simple(${index}/${sourcetype}) → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  }
}

/** HEC sender over the event collector port (default 8088). */
export class SplunkHec {
  constructor(baseUrl, token) {
    this.base = baseUrl.replace(/\/$/, '');
    this.token = token;
  }
  async send(events) {
    const body = events.map(e => JSON.stringify(e)).join('\n');
    const res = await rawRequest(`${this.base}/services/collector/event`, 'POST', {
      Authorization: `Splunk ${this.token}`,
      'Content-Type': 'application/json',
    }, body, 120000);
    if (!res.ok) throw new Error(`HEC send → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export function log(msg) { console.log(msg); }
export function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }
