/**
 * Splunk Mock Server — Phase 10
 *
 * Lightweight HTTP server that mimics the Splunk REST API (port 8089).
 * Used in the chaos sandbox so the full pipeline runs without a real
 * Splunk instance.
 *
 * Implements the endpoints actually called by our codebase:
 *   POST /services/search/v2/jobs               — create search job (async SID)
 *   GET  /services/search/v2/jobs/:sid          — poll job status
 *   GET  /services/search/v2/jobs/:sid/results  — fetch results
 *   GET  /services/saved/searches               — knowledge object inventory
 *   GET  /services/server/info                  — server health check
 *   GET  /services/data/indexes                 — index metadata
 *   POST /services/search/v2/jobs/export        — synchronous search export
 *
 * SAFETY GUARD: Only starts when APP_ENV != production.
 * Responses are tagged with X-Splunk-Mock: true header.
 *
 * Usage:
 *   APP_ENV=sandbox MOCK_PORT=8089 npx ts-node tools/sandbox/splunk-mock-server.ts
 *
 * Or via docker-compose:
 *   services:
 *     splunk-mock:
 *       build: { context: ., dockerfile: docker/Dockerfile.mock }
 *       ports: ["8089:8089"]
 *       environment: [APP_ENV=sandbox]
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as url from 'url';

// ─────────────────────────────────────────────────────────────────────────────
// Safety guard
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.APP_ENV === 'production') {
  throw new Error('[SplunkMockServer] FATAL: Will not start in APP_ENV=production');
}

const PORT = parseInt(process.env.MOCK_PORT ?? '18089', 10); // Default 18089 to avoid conflict

// ─────────────────────────────────────────────────────────────────────────────
// Mock data catalogue — draws from chaos generator
// ─────────────────────────────────────────────────────────────────────────────

interface MockIndex {
  name:               string;
  sourcetype:         string;
  dailyAvgGb:         number;
  currentSizeMb:      number;
  maxSizeMb:          number;
  eventCount:         number;
  oldestEvent:        string;
  latestEvent:        string;
  retentionDays?:     number; // if set, overrides the default 90-day frozenTimePeriodInSecs
}

// Realistic enterprise Splunk environment: 20 indexes across Critical/Important/Nice-to-Have/Low-Value tiers.
// retentionDays drives frozenTimePeriodInSecs in the API response; the LLM candidate filter requires
// retentionDays > 365 OR dailyAvgGb > 1 OR lastEvent > 30d stale. Active high-value indexes get 395-day
// retention so they qualify as LONG_RETENTION candidates and receive AI narrative.
const MOCK_INDEXES: MockIndex[] = [
  // ── Critical tier: high-utilization, core security/ops (395-day retention → LONG_RETENTION candidate)
  { name: 'main',              sourcetype: 'access_combined',      dailyAvgGb: 12.4, currentSizeMb: 180_000, maxSizeMb: 300_000, eventCount: 24_800_000, oldestEvent: '2023-01-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'security',          sourcetype: 'WinEventLog',          dailyAvgGb: 8.2,  currentSizeMb: 120_000, maxSizeMb: 200_000, eventCount: 16_400_000, oldestEvent: '2023-06-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'network',           sourcetype: 'cisco_asa',            dailyAvgGb: 6.1,  currentSizeMb:  90_000, maxSizeMb: 150_000, eventCount: 12_200_000, oldestEvent: '2023-03-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'aws_cloudtrail',    sourcetype: 'aws:cloudtrail',       dailyAvgGb: 4.8,  currentSizeMb:  70_000, maxSizeMb: 120_000, eventCount:  9_600_000, oldestEvent: '2023-01-15T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'endpoint',          sourcetype: 'crowdstrike',          dailyAvgGb: 3.5,  currentSizeMb:  50_000, maxSizeMb:  80_000, eventCount:  7_000_000, oldestEvent: '2023-02-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  // ── Important tier: secondary ops (395-day retention)
  { name: 'auth',              sourcetype: 'okta:system',          dailyAvgGb: 2.1,  currentSizeMb:  30_000, maxSizeMb:  50_000, eventCount:  4_200_000, oldestEvent: '2023-04-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'kubernetes',        sourcetype: 'kubernetes:container', dailyAvgGb: 7.3,  currentSizeMb: 105_000, maxSizeMb: 180_000, eventCount: 14_600_000, oldestEvent: '2023-05-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'web_access',        sourcetype: 'nginx:access',         dailyAvgGb: 9.1,  currentSizeMb: 130_000, maxSizeMb: 220_000, eventCount: 18_200_000, oldestEvent: '2023-01-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'firewall',          sourcetype: 'pan:traffic',          dailyAvgGb: 5.4,  currentSizeMb:  78_000, maxSizeMb: 130_000, eventCount: 10_800_000, oldestEvent: '2023-02-15T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'linux_syslog',      sourcetype: 'syslog',               dailyAvgGb: 3.8,  currentSizeMb:  55_000, maxSizeMb:  90_000, eventCount:  7_600_000, oldestEvent: '2023-03-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'azure_activity',    sourcetype: 'azure:activity',       dailyAvgGb: 2.9,  currentSizeMb:  42_000, maxSizeMb:  70_000, eventCount:  5_800_000, oldestEvent: '2023-04-15T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'vulnerability',     sourcetype: 'tenable:sc',           dailyAvgGb: 1.2,  currentSizeMb:  17_000, maxSizeMb:  30_000, eventCount:  2_400_000, oldestEvent: '2023-05-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  // ── Nice-to-Have: lower-signal active indexes (395-day retention)
  { name: 'dns',               sourcetype: 'stream:dns',           dailyAvgGb: 4.5,  currentSizeMb:  65_000, maxSizeMb: 110_000, eventCount:  9_000_000, oldestEvent: '2023-01-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'vpn',               sourcetype: 'cisco:vpn',            dailyAvgGb: 0.8,  currentSizeMb:  11_000, maxSizeMb:  20_000, eventCount:  1_600_000, oldestEvent: '2023-06-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'email',             sourcetype: 'ms:o365:email',        dailyAvgGb: 1.4,  currentSizeMb:  20_000, maxSizeMb:  35_000, eventCount:  2_800_000, oldestEvent: '2023-03-15T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  // ── Low-Value / zombie indexes: stale data, no recent events → STALE_INDEX candidates
  // Large currentSizeMb means non-trivial cost → hasMaterialFootprint=true
  { name: 'legacy_edr',        sourcetype: 'old_edr',           dailyAvgGb: 0.05, currentSizeMb: 50_000, maxSizeMb:  80_000, eventCount:   100_000,  oldestEvent: '2021-01-01T00:00:00Z', latestEvent: '2023-01-01T00:00:00Z', retentionDays: 395 },
  { name: 'deprecated_siem',   sourcetype: 'legacy_siem',       dailyAvgGb: 0.01, currentSizeMb: 35_000, maxSizeMb:  60_000, eventCount:    20_000,  oldestEvent: '2020-06-01T00:00:00Z', latestEvent: '2022-12-01T00:00:00Z', retentionDays: 395 },
  { name: 'old_itsm',          sourcetype: 'legacy_itsm',       dailyAvgGb: 0.02, currentSizeMb: 18_000, maxSizeMb:  30_000, eventCount:    40_000,  oldestEvent: '2021-03-01T00:00:00Z', latestEvent: '2023-03-01T00:00:00Z', retentionDays: 395 },
  // ── Duplicate indexes: same sourcetype as active peers → wasteful spend
  { name: 'web_access_dup',    sourcetype: 'nginx:access',      dailyAvgGb: 9.1,  currentSizeMb: 130_000, maxSizeMb: 220_000, eventCount: 18_200_000, oldestEvent: '2023-01-01T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
  { name: 'cloudtrail_mirror', sourcetype: 'aws:cloudtrail',    dailyAvgGb: 4.8,  currentSizeMb:  70_000, maxSizeMb: 120_000, eventCount:  9_600_000, oldestEvent: '2023-01-15T00:00:00Z', latestEvent: new Date().toISOString(), retentionDays: 395 },
];

// ─────────────────────────────────────────────────────────────────────────────
// In-memory SID job store
// ─────────────────────────────────────────────────────────────────────────────

interface SidJob {
  sid:          string;
  spl:          string;
  status:       'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  resultCount:  number;
  startedAt:    number;
  completesAt:  number;
}

const jobs = new Map<string, SidJob>();

function createJob(spl: string): SidJob {
  const sid = `mock_${crypto.randomBytes(8).toString('hex')}`;
  const job: SidJob = {
    sid,
    spl,
    status: 'QUEUED',
    resultCount: Math.floor(Math.random() * 1000) + 100,
    startedAt: Date.now(),
    completesAt: Date.now() + Math.random() * 800 + 200, // 200–1000ms simulated latency
  };
  jobs.set(sid, job);
  // Advance status after delay
  setTimeout(() => { if (jobs.has(sid)) { jobs.get(sid)!.status = 'RUNNING'; } }, 100);
  setTimeout(() => { if (jobs.has(sid)) { jobs.get(sid)!.status = 'DONE'; } },
    job.completesAt - job.startedAt);
  return job;
}

function jobStatusResponse(job: SidJob): object {
  const doneRatio = Math.min(1, (Date.now() - job.startedAt) / (job.completesAt - job.startedAt));
  return {
    entry: [{
      name:    job.sid,
      content: {
        sid:              job.sid,
        dispatchState:    job.status === 'DONE' ? 'DONE' : job.status === 'RUNNING' ? 'RUNNING' : 'QUEUED',
        doneProgress:     job.status === 'DONE' ? 1 : doneRatio,
        eventCount:       job.status === 'DONE' ? job.resultCount : 0,
        resultCount:      job.status === 'DONE' ? job.resultCount : 0,
        scanCount:        job.resultCount * 10,
        isFinalized:      job.status === 'DONE',
        isDone:           job.status === 'DONE',
      },
    }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response builders
// ─────────────────────────────────────────────────────────────────────────────

function buildIndexListResponse(): object {
  return {
    entry: MOCK_INDEXES.map(idx => ({
      name: idx.name,
      content: {
        name:              idx.name,
        defaultDatabase:   'DEFAULT',
        disabled:          false,
        assureUTF8:        false,
        coldPath:          `/opt/splunk/var/lib/splunk/${idx.name}/colddb`,
        homePath:          `/opt/splunk/var/lib/splunk/${idx.name}/db`,
        thawedPath:        `/opt/splunk/var/lib/splunk/${idx.name}/thaweddb`,
        totalEventCount:   idx.eventCount,
        currentDBSizeMB:   idx.currentSizeMb,
        maxTotalDataSizeMB: idx.maxSizeMb,
        minTime:           idx.oldestEvent,
        maxTime:           idx.latestEvent,
        summaryReplicationFactor: 1,
        datatype:          'event',
        frozenTimePeriodInSecs: (idx.retentionDays ?? 90) * 86400,
        syncMeta:          true,
      },
    })),
    paging: { total: MOCK_INDEXES.length, perPage: 100, offset: 0 },
  };
}

/**
 * Per-index MITRE ATT&CK technique + Lantern use-case counts, mirroring what the
 * TA-bitsIO-datasensAI add-on writes to sourcetype_attack_mapping.csv /
 * sourcetype_lantern_mapping.csv in a real customer environment. Security-relevant
 * sources get high MITRE; ops/business sources get high Lantern; legacy/inert
 * sources get near-zero of both (so detection scores spread realistically).
 */
const MOCK_DETECTION_MAP: Record<string, { mitre: number; lantern: number }> = {
  main:              { mitre: 12, lantern: 6 },
  security:          { mitre: 65, lantern: 8 },
  network:           { mitre: 58, lantern: 5 },
  aws_cloudtrail:    { mitre: 45, lantern: 8 },
  endpoint:          { mitre: 60, lantern: 4 },
  auth:              { mitre: 30, lantern: 6 },
  kubernetes:        { mitre: 18, lantern: 9 },
  web_access:        { mitre: 8,  lantern: 5 },
  firewall:          { mitre: 25, lantern: 6 },
  linux_syslog:      { mitre: 10, lantern: 4 },
  azure_activity:    { mitre: 30, lantern: 7 },
  vulnerability:     { mitre: 20, lantern: 5 },
  dns:               { mitre: 20, lantern: 6 },
  vpn:               { mitre: 8,  lantern: 4 },
  email:             { mitre: 15, lantern: 5 },
  legacy_edr:        { mitre: 0,  lantern: 0 },
  deprecated_siem:   { mitre: 0,  lantern: 0 },
  old_itsm:          { mitre: 0,  lantern: 4 },
  web_access_dup:    { mitre: 8,  lantern: 5 },
  cloudtrail_mirror: { mitre: 45, lantern: 8 },
};

function buildSearchResults(spl: string): object {
  // Parse the SPL to decide what kind of mock result to return
  const isParsingErrors = /index=_internal.*component=/i.test(spl);
  const isTstats        = /^\s*\|\s*tstats/i.test(spl);
  const isSavedSearches = false; // handled by /services/saved/searches

  // TA lookups: MITRE ATT&CK + Lantern mappings (sourcetype_attack_mapping.csv /
  // sourcetype_lantern_mapping.csv). Emit one row per index AND per sourcetype so
  // detection resolves whether scoring keys by index name or sourcetype.
  const isAttackLookup  = /inputlookup\s+sourcetype_attack_mapping\.csv/i.test(spl);
  const isLanternLookup = /inputlookup\s+sourcetype_lantern_mapping\.csv/i.test(spl);

  // 1stmile customer-profile volume lookup. The worker queries
  //   | inputlookup 1stmile_index_sourcetype_and_source_volume_lookupcsv
  //   | stats sum(GB_idx_st_s) as raw_gb by index
  // and then normalises the per-index raw_gb so the totals sum to the
  // Teja-confirmed 92 GB/day logical baseline. We emit one row per mock
  // index using its dailyAvgGb as raw_gb; the normalisation in
  // splunk-client.getVolumeFromCustomerProfileLookup() scales these to 92 GB.
  const is1stmileVolumeLookup = /inputlookup\s+1stmile_index_sourcetype_and_source_volume_lookupcsv/i.test(spl);
  if (is1stmileVolumeLookup) {
    return {
      results: MOCK_INDEXES.map(idx => ({
        index: idx.name,
        raw_gb: String(idx.dailyAvgGb),
      })),
      fields: [{ name: 'index' }, { name: 'raw_gb' }],
    };
  }

  if (isAttackLookup || isLanternLookup) {
    const countKey = isAttackLookup ? 'technique_count' : 'lantern_usecase_count';
    const rows: Array<Record<string, string>> = [];
    for (const idx of MOCK_INDEXES) {
      const m = MOCK_DETECTION_MAP[idx.name];
      if (!m) continue;
      const count = isAttackLookup ? m.mitre : m.lantern;
      rows.push({ sourcetype: idx.name, [countKey]: String(count) });
      if (idx.sourcetype && idx.sourcetype !== idx.name) {
        rows.push({ sourcetype: idx.sourcetype, [countKey]: String(count) });
      }
    }
    return { results: rows, fields: [{ name: 'sourcetype' }, { name: countKey }] };
  }

  if (isParsingErrors) {
    return {
      results: MOCK_INDEXES.slice(0, 5).map(idx => ({
        idx:              idx.name,
        st:               idx.sourcetype,
        weighted_issues:  (Math.random() * 50).toFixed(2),
      })),
      fields: [{ name: 'idx' }, { name: 'st' }, { name: 'weighted_issues' }],
    };
  }

  if (isTstats) {
    return {
      results: MOCK_INDEXES.map(idx => ({
        index:       idx.name,
        sourcetype:  idx.sourcetype,
        count:       String(Math.floor(idx.dailyAvgGb * 1_000_000)),
        'sum(bytes)': String(Math.floor(idx.dailyAvgGb * 1024 * 1024 * 1024)),
      })),
      fields: [{ name: 'index' }, { name: 'sourcetype' }, { name: 'count' }, { name: 'sum(bytes)' }],
    };
  }

  // Default: generic event results
  return {
    results: Array.from({ length: 10 }, (_, i) => ({
      _time:      new Date(Date.now() - i * 60_000).toISOString(),
      index:      MOCK_INDEXES[i % MOCK_INDEXES.length].name,
      sourcetype: MOCK_INDEXES[i % MOCK_INDEXES.length].sourcetype,
      host:       `mock-host-${i}`,
      _raw:       `[mock event ${i}] ${spl.substring(0, 40)}`,
    })),
    fields: [{ name: '_time' }, { name: 'index' }, { name: 'sourcetype' }, { name: 'host' }, { name: '_raw' }],
  };
}

function buildSavedSearchesResponse(): object {
  const searches = MOCK_INDEXES.slice(0, 12).flatMap((idx, i) => [
    {
      name:    `Alert: ${idx.name} anomaly detection`,
      content: {
        search:        `index=${idx.name} | anomalydetection`,
        alert_type:    'number of events',
        cron_schedule: '*/15 * * * *',
        is_scheduled:  '1',
        dispatch: { earliest_time: '-15m', latest_time: 'now' },
      },
    },
    {
      name:    `Dashboard: ${idx.name} overview`,
      content: {
        search:        `index=${idx.name} | stats count by sourcetype`,
        alert_type:    'always',
        cron_schedule: '',
        is_scheduled:  '0',
      },
    },
  ]);

  return {
    entry:  searches,
    paging: { total: searches.length, perPage: 200, offset: 0 },
  };
}

function buildServerInfo(): object {
  return {
    entry: [{
      name: 'server-info',
      content: {
        activeLicenseGroup:  'Enterprise',
        build:               '9.0.4',
        cpu_arch:            'x86_64',
        fips_mode:           false,
        guid:                'mock-splunk-guid-chaos-sandbox',
        health_info:         'green',
        host:                'mock-splunk.chaos.internal',
        licenseState:        'OK',
        master_guid:         'mock-master-guid',
        mode:                'normal',
        numberOfVirtualCores: 8,
        os_name:             'Linux',
        os_version:          '5.15.0',
        product_type:        'enterprise',
        serverName:          'mock-splunk-chaos',
        version:             '9.0.4',
      },
    }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request router
// ─────────────────────────────────────────────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(new URLSearchParams(data)); } catch { resolve(new URLSearchParams()); }
    });
  });
}

function jsonResponse(res: http.ServerResponse, body: object, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Splunk-Mock': 'true',
    'X-Mock-Version': '1.0',
  });
  res.end(payload);
}

async function router(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed   = url.parse(req.url ?? '/', true);
  const pathname = parsed.pathname ?? '/';
  const method   = req.method ?? 'GET';

  // ── Health / Info ──
  if (pathname === '/services/server/info') {
    return jsonResponse(res, buildServerInfo());
  }

  // ── Index metadata ──
  if (pathname === '/services/data/indexes') {
    return jsonResponse(res, buildIndexListResponse());
  }

  // ── Saved searches ──
  if (pathname === '/services/saved/searches') {
    return jsonResponse(res, buildSavedSearchesResponse());
  }

  // ── Create async search job ──
  if (method === 'POST' && pathname === '/services/search/v2/jobs') {
    const body = await parseBody(req);
    const spl  = body.get('search') ?? '';
    const job  = createJob(spl);
    return jsonResponse(res, { sid: job.sid }, 201);
  }

  // ── Poll job status ──
  const jobStatusMatch = pathname.match(/^\/services\/search\/v2\/jobs\/([^/]+)$/);
  if (jobStatusMatch && method === 'GET') {
    const sid = jobStatusMatch[1];
    const job = jobs.get(sid);
    if (!job) return jsonResponse(res, { messages: [{ type: 'ERROR', text: 'Unknown sid' }] }, 404);
    return jsonResponse(res, jobStatusResponse(job));
  }

  // ── Fetch job results ──
  const resultsMatch = pathname.match(/^\/services\/search\/v2\/jobs\/([^/]+)\/results/);
  if (resultsMatch && method === 'GET') {
    const sid = resultsMatch[1];
    const job = jobs.get(sid);
    if (!job) return jsonResponse(res, { messages: [{ type: 'ERROR', text: 'Unknown sid' }] }, 404);
    if (job.status !== 'DONE') {
      return jsonResponse(res, { messages: [{ type: 'INFO', text: 'Job not complete' }] }, 204);
    }
    return jsonResponse(res, buildSearchResults(job.spl));
  }

  // ── Synchronous export (v2 and legacy path — splunk-client uses /services/search/jobs/export) ──
  if (method === 'POST' && (
    pathname === '/services/search/v2/jobs/export' ||
    pathname === '/services/search/jobs/export'
  )) {
    const body = await parseBody(req);
    const spl  = body.get('search') ?? '';
    // Return newline-delimited JSON (splunk export format) so runSearchJob parses correctly
    const results = buildSearchResults(spl) as any;
    const lines = (results.results || []).map((r: any) => JSON.stringify({ result: r })).join('\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(lines);
    return;
  }

  // ── Legacy search endpoint ──
  if (method === 'POST' && pathname === '/services/search/jobs') {
    const body = await parseBody(req);
    const spl  = body.get('search') ?? '';
    const job  = createJob(spl);
    return jsonResponse(res, { sid: job.sid }, 201);
  }

  // ── Fallback ──
  console.warn(`[SplunkMock] Unhandled: ${method} ${pathname}`);
  return jsonResponse(res, {
    messages: [{ type: 'WARN', text: `Unhandled mock endpoint: ${method} ${pathname}` }],
    _mock: true,
  }, 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// Server lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (err) {
    console.error('[SplunkMock] Unhandled error:', err);
    jsonResponse(res, { error: (err as Error).message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SplunkMock] Mock Splunk server listening on :${PORT}`);
  console.log(`[SplunkMock] ${MOCK_INDEXES.length} synthetic indexes available`);
  console.log(`[SplunkMock] Endpoints:`);
  console.log(`  GET  /services/server/info`);
  console.log(`  GET  /services/data/indexes`);
  console.log(`  GET  /services/saved/searches`);
  console.log(`  POST /services/search/v2/jobs`);
  console.log(`  GET  /services/search/v2/jobs/:sid`);
  console.log(`  GET  /services/search/v2/jobs/:sid/results`);
  console.log(`  POST /services/search/v2/jobs/export`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SplunkMock] SIGTERM received — shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

export { server, MOCK_INDEXES };
