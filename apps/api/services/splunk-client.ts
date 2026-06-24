import * as http from 'http';
import * as https from 'https';

export interface SplunkQueryResult {
  index: string;
  sourcetype?: string;
  totalEvents: number;
  dailyAvgGb: number;
  retentionDays: number;
  firstEvent: string;
  lastEvent: string;
}

export interface SplunkMCPConfig {
  mcpUrl: string;
  token: string;
  allowInsecureTls?: boolean;
  timeoutMs?: number;
}

interface HttpTextResponse {
  status: number;
  ok: boolean;
  text: string;
}

const RETRY_DELAYS_MS = [1000, 3000]; // 2 attempts: immediate + 1 retry after 3s

/**
 * The Splunk surface the aggregation pipeline depends on. SplunkClient (REST)
 * and SplunkMcpAdapter (MCP-with-REST-fallback) both implement it, so the
 * pipeline is agnostic to which transport a tenant is configured for.
 */
export interface SplunkDataSource {
  healthCheckFast(): Promise<{ success: boolean; latencyMs: number; error?: string }>;
  getIndexMetrics(): Promise<SplunkQueryResult[]>;
  getSourcetypeMetrics(index: string): Promise<SplunkQueryResult[]>;
  getBatchSourcetypeMetrics(indexes: string[]): Promise<SplunkQueryResult[]>;
  getSavedSearches(): Promise<Array<{
    name: string; app: string; isScheduled: boolean; isAlert: boolean;
    schedule: string; lastRun: string | null; disabled: boolean;
  }>>;
  restGet(pathWithQuery: string): Promise<any>;
  runSearch(spl: string, opts?: { earliestTime?: string; latestTime?: string }): Promise<any[]>;
}

export class SplunkClient implements SplunkDataSource {
  private config: SplunkMCPConfig;

  constructor(config: SplunkMCPConfig) {
    if (!config.mcpUrl) throw new Error('Splunk MCP URL is required');
    // If timeout not explicitly passed, read from SPLUNK_QUERY_TIMEOUT env var
    if (!config.timeoutMs) {
      const envTimeout = parseInt(process.env.SPLUNK_QUERY_TIMEOUT || '30', 10);
      config.timeoutMs = envTimeout * 1000; // Convert seconds to ms
    }
    this.config = config;
  }

  private parseJsonOrThrow(raw: string, endpoint: string): any {
    const trimmed = (raw || '').trim();
    if (!trimmed) {
      throw new Error(`Splunk returned empty JSON payload from ${endpoint}`);
    }
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown JSON parse error';
      throw new Error(`Invalid JSON from ${endpoint}: ${msg}. Payload preview: ${trimmed.slice(0, 200)}`);
    }
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs ?? 30000; // Default 30s (from env)
  }

  private getAuthHeader(): string {
    const raw = this.config.token.trim().replace(/^Authorization:\s*/i, '').trim();
    // If already a complete auth header (Basic, Bearer, Splunk), use as-is
    if (/^(Basic|Bearer|Splunk)\s+/i.test(raw)) return raw;
    // Otherwise treat as a raw Splunk token
    return `Splunk ${raw}`;
  }

  private getBearerHeader(): string {
    return this.getAuthHeader();
  }

  private getSplunkHeader(): string {
    return this.getAuthHeader();
  }

  private getRestBaseUrl(): string {
    const url = new URL(this.config.mcpUrl);
    return `${url.protocol}//${url.host}`;
  }

  private requestText(
    targetUrl: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body?: string
  ): Promise<HttpTextResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(targetUrl);
      const client = url.protocol === 'https:' ? https : http;
      const payload = body || '';

      const req = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method,
          headers: {
            ...headers,
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          },
          timeout: this.timeoutMs,
          rejectUnauthorized: url.protocol === 'https:' ? !this.config.allowInsecureTls : undefined,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { text += chunk; });
          res.on('end', () => {
            const status = res.statusCode || 0;
            resolve({ status, ok: status >= 200 && status < 300, text });
          });
        }
      );

      req.on('timeout', () => req.destroy(new Error(`Request timed out after ${Math.round(this.timeoutMs / 1000)}s`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error = new Error('Unknown error');
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        // Don't retry auth errors or "not found" — only transient connectivity issues
        const isTransient = lastError.message.includes('timed out') ||
          lastError.message.includes('ECONNRESET') ||
          lastError.message.includes('ETIMEDOUT') ||
          lastError.message.includes('socket hang up');
        if (!isTransient || attempt >= RETRY_DELAYS_MS.length) break;
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
    throw lastError;
  }

  /**
   * Fast health check via the Splunk REST server info endpoint.
   */
  async healthCheckFast(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await this.requestText(
        `${this.getRestBaseUrl()}/services/server/info?output_mode=json`,
        'GET',
        { 'Authorization': this.getBearerHeader() }
      );
      if (!res.ok) {
        const hint =
          res.status === 401 ? 'Invalid or expired token' :
          res.status === 403 ? 'Token lacks permission' :
          `HTTP ${res.status}`;
        return { success: false, latencyMs: Date.now() - start, error: hint };
      }
      return { success: true, latencyMs: Date.now() - start };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const url = new URL(this.config.mcpUrl);
      const port = url.port || '8089';
      if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') ||
          msg.includes('timed out') || msg.includes('ETIMEDOUT')) {
        return {
          success: false,
          latencyMs: Date.now() - start,
          error: `Cannot reach ${url.hostname}:${port}. Port ${port} appears blocked by a firewall. Open TCP ${port} inbound in your server firewall.`,
        };
      }
      return { success: false, latencyMs: Date.now() - start, error: msg };
    }
  }

  /**
   * Fetch all index metadata in one REST call (no event scanning, very fast).
   * Returns size, retention, and event counts directly from Splunk index metadata.
   */
  async getIndexMetrics(): Promise<SplunkQueryResult[]> {
    return this.withRetry(async () => {
      const res = await this.requestText(
        `${this.getRestBaseUrl()}/services/data/indexes?output_mode=json&count=500&summarize=false`,
        'GET',
        { 'Authorization': this.getBearerHeader() }
      );

      if (!res.ok) {
        if (res.status === 401) throw new Error('Splunk authentication failed (401). Token is invalid or expired.');
        if (res.status === 403) throw new Error('Splunk access denied (403). Token lacks permission to list indexes.');
        throw new Error(`Splunk index list failed: HTTP ${res.status}`);
      }

      const data = this.parseJsonOrThrow(res.text, '/services/data/indexes');
      const entries: any[] = data.entry || [];

      // Lookup-first: read the 1stmile customer profile lookup when present.
      // This normalizes logical daily ingest to Teja's confirmed 92 GB/day baseline
      // regardless of how much was physically injected into this dev environment.
      const profileGbByIndex = await this.getVolumeFromCustomerProfileLookup().catch(() => new Map<string, number>());

      // Try to enrich with real 24h ingest bytes from license_usage (if permissions allow).
      const ingestGbByIndex = await this.getRecentDailyIngestGbByIndex().catch(() => new Map<string, number>());
      // Stronger fallback for demo/small environments: derive 24h bytes directly from event payload.
      const sampledGbByIndex = await this.getRecentRawBytesGbByIndex(
        entries.filter(e => e.name && !e.name.startsWith('_')).map((e) => e.name).slice(0, 30)
      ).catch(() => new Map<string, number>());

      // Filter out internal Splunk indexes
      return entries
        .filter(e => e.name && !e.name.startsWith('_'))
        .map(e => {
          const content = e.content || {};
          const currentSizeMB = parseFloat(content.currentDBSizeMB || content.maxTotalDataSizeMB || '0');
          const retentionSecs = parseInt(content.frozenTimePeriodInSecs || '7776000', 10);
          const retentionDays = Math.max(1, Math.round(retentionSecs / 86400));
          const metadataDailyGb = currentSizeMB > 0 ? parseFloat((currentSizeMB / 1024 / retentionDays).toFixed(4)) : 0;
          const licenseDailyGb = ingestGbByIndex.get(e.name) ?? 0;
          const sampledDailyGb = sampledGbByIndex.get(e.name) ?? 0;
          // Profile lookup wins: it carries the confirmed logical customer ingest baseline.
          // Falls back to physical Splunk measurements when no lookup is present.
          const profileDailyGb = profileGbByIndex.get(e.name) ?? 0;
          const dailyAvgGb = profileDailyGb > 0
            ? profileDailyGb
            : Math.max(metadataDailyGb, licenseDailyGb, sampledDailyGb);

          return {
            index: e.name,
            totalEvents: parseInt(content.totalEventCount || '0', 10),
            dailyAvgGb,
            retentionDays,
            firstEvent: content.minTime || new Date(Date.now() - retentionDays * 86400000).toISOString(),
            lastEvent: content.maxTime || new Date().toISOString(),
          };
        })
        .filter(r => r.totalEvents > 0 || r.dailyAvgGb > 0); // skip completely empty indexes
    }, 'getIndexMetrics');
  }

  /**
   * Lookup-first volume path for the 1stmile customer profile.
   *
   * Returns the per-index daily-average GB derived from the customer's own
   * lookup rows: total GB / distinct dates in the lookup. No hardcoded
   * normalization target — if the customer's lookup covers 2 days summing
   * to 159.93 GB, this returns ~80 GB/day; if it covers 30 days, this
   * returns the corresponding 30-day daily average. The value reflects
   * whatever the customer's data says, not a magic constant.
   *
   * Returns an empty map when the lookup is absent (graceful fallback to
   * physical Splunk measurements via currentDBSizeMB/retentionDays).
   */
  private async getVolumeFromCustomerProfileLookup(): Promise<Map<string, number>> {
    const LOOKUP_NAME = '1stmile_index_sourcetype_and_source_volume_lookupcsv';

    // Group by index AND distinct date. dc(date) tells us how many calendar
    // days the lookup spans, so total_gb / date_count is the true daily average
    // implied by the rows — no business value injected by code.
    const rows = await this.runSearchJob(
      `| inputlookup ${LOOKUP_NAME} ` +
      `| eval lookup_date=strftime(_time, "%Y-%m-%d") ` +
      `| stats sum(GB_idx_st_s) as total_gb dc(lookup_date) as date_count by index`
    ).catch(() => []);

    const out = new Map<string, number>();
    for (const row of rows) {
      const totalGb = parseFloat((row as any).total_gb ?? '0');
      const dateCount = Math.max(1, parseInt((row as any).date_count ?? '1', 10));
      const idx: string = (row as any).index ?? '';
      if (!idx || !(totalGb > 0)) continue;
      const dailyGb = totalGb / dateCount;
      out.set(idx, parseFloat(dailyGb.toFixed(4)));
    }
    return out;
  }

  /**
   * Sample recent raw event bytes directly from indexes (last 24h).
   * This makes low-volume demo ingestion visible faster than license/index metadata alone.
   */
  private async getRecentRawBytesGbByIndex(indexes: string[]): Promise<Map<string, number>> {
    if (indexes.length === 0) return new Map();
    const where = indexes.map((idx) => `index="${idx}"`).join(' OR ');
    const spl = `search (${where}) earliest=-24h latest=now()
| eval _bytes=len(_raw)
| stats sum(_bytes) as raw_bytes count as observed_events by index`;

    const rows = await this.runSearchJob(spl);
    const out = new Map<string, number>();
    for (const row of rows) {
      const index = row.index;
      if (!index) continue;
      const rawBytes = parseFloat(row.raw_bytes || '0');
      if (!Number.isFinite(rawBytes) || rawBytes <= 0) continue;
      const gb = parseFloat((rawBytes / (1024 * 1024 * 1024)).toFixed(4));
      if (gb > 0) out.set(index, gb);
    }
    return out;
  }

  /**
   * Query Splunk license usage for last 24h and derive daily ingest GB per index.
   * This reflects fresh writes better than currentDBSize-based approximation.
   */
  private async getRecentDailyIngestGbByIndex(): Promise<Map<string, number>> {
    // Phase 13: tstats audit — license_usage.log lives in _internal and has no CIM data model,
    // so raw SPL is the correct last-resort per the tstats hierarchy (tstats→metadata→mstats→raw).
    // Time bounds (earliest=-24h latest=now()) + | head 1000 circuit breaker are mandatory.
    const spl = `search index=_internal source=*license_usage.log type=Usage earliest=-24h latest=now()
| eval index=coalesce(idx, index)
| where isnotnull(index) AND index!="_internal"
| head 1000
| stats sum(b) as bytes by index`;

    const rows = await this.runSearchJob(spl);
    const out = new Map<string, number>();
    for (const row of rows) {
      const index = row.index;
      if (!index) continue;
      const bytes = parseFloat(row.bytes || '0');
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      const gb = parseFloat((bytes / (1024 * 1024 * 1024)).toFixed(4));
      if (gb > 0) out.set(index, gb);
    }
    return out;
  }

  /**
   * Fetch sourcetype breakdown for an index via tstats — one query, all sourcetypes.
   * Batching is handled by the caller (aggregation-service).
   */
  async getSourcetypeMetrics(index: string): Promise<SplunkQueryResult[]> {
    const spl = `| tstats count AS totalEvents WHERE index="${index}" earliest=-24h latest=now() BY sourcetype | sort - totalEvents | head 30`;
    return this.withRetry(async () => {
      const rows = await this.runSearchJob(spl);
      return rows.map((row: any) => ({
        index,
        sourcetype: row.sourcetype || 'unknown',
        totalEvents: parseInt(row.totalEvents || row.count || '0', 10),
        dailyAvgGb: 0,
        retentionDays: 90,
        firstEvent: new Date(Date.now() - 86400000).toISOString(),
        lastEvent: new Date().toISOString(),
      }));
    }, `getSourcetypeMetrics(${index})`);
  }

  /**
   * Fetch sourcetype breakdown for ALL high-volume indexes in a single tstats query.
   * Much faster than calling getSourcetypeMetrics() in a loop.
   */
  async getBatchSourcetypeMetrics(indexes: string[]): Promise<SplunkQueryResult[]> {
    if (indexes.length === 0) return [];
    const indexFilter = indexes.map(i => `index="${i}"`).join(' OR ');
    const spl = `| tstats count AS totalEvents WHERE (${indexFilter}) earliest=-24h latest=now() BY index sourcetype | sort - totalEvents | head 200`;
    return this.withRetry(async () => {
      const rows = await this.runSearchJob(spl);
      return rows.map((row: any) => ({
        index: row.index || 'unknown',
        sourcetype: row.sourcetype || 'unknown',
        totalEvents: parseInt(row.totalEvents || row.count || '0', 10),
        dailyAvgGb: 0,
        retentionDays: 90,
        firstEvent: new Date(Date.now() - 86400000).toISOString(),
        lastEvent: new Date().toISOString(),
      }));
    }, 'getBatchSourcetypeMetrics');
  }

  /**
   * Fetch all saved searches and alerts via Splunk REST.
   * Returns lightweight objects with name, app, schedule, and last run info.
   */
  async getSavedSearches(): Promise<Array<{
    name: string;
    app: string;
    isScheduled: boolean;
    isAlert: boolean;
    schedule: string;
    lastRun: string | null;
    disabled: boolean;
  }>> {
    return this.withRetry(async () => {
      const res = await this.requestText(
        `${this.getRestBaseUrl()}/servicesNS/-/-/saved/searches?output_mode=json&count=500&search=disabled%3D0`,
        'GET',
        { 'Authorization': this.getBearerHeader() }
      );

      if (!res.ok) {
        if (res.status === 401) throw new Error('Splunk auth failed (401)');
        if (res.status === 403) throw new Error('Splunk access denied (403)');
        throw new Error(`Saved searches failed: HTTP ${res.status}`);
      }

      const data = this.parseJsonOrThrow(res.text, '/servicesNS/-/-/saved/searches');
      return (data.entry || []).map((e: any) => {
        const c = e.content || {};
        return {
          name: e.name || '',
          app: e.acl?.app || 'unknown',
          isScheduled: c['is_scheduled'] === '1' || c['is_scheduled'] === true,
          isAlert: !!(c['alert_type'] && c['alert_type'] !== 'always'),
          schedule: c['cron_schedule'] || '',
          lastRun: c['next_scheduled_time'] || null,
          disabled: c['disabled'] === '1' || c['disabled'] === true,
        };
      });
    }, 'getSavedSearches');
  }

  /**
   * Public REST GET against the Splunk management port.
   * `pathWithQuery` is appended to the base URL (e.g. "/servicesNS/-/-/saved/searches?output_mode=json").
   * Returns the parsed JSON body; throws on non-2xx or invalid JSON.
   */
  async restGet(pathWithQuery: string): Promise<any> {
    const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    return this.withRetry(async () => {
      const res = await this.requestText(
        `${this.getRestBaseUrl()}${path}`,
        'GET',
        { 'Authorization': this.getBearerHeader() }
      );
      if (!res.ok) {
        if (res.status === 401) throw new Error(`Splunk auth failed (401) on ${path}`);
        if (res.status === 403) throw new Error(`Splunk access denied (403) on ${path}`);
        throw new Error(`Splunk REST GET ${path} failed: HTTP ${res.status}`);
      }
      return this.parseJsonOrThrow(res.text, path);
    }, `restGet(${path})`);
  }

  /**
   * Public oneshot SPL search. Optional earliest/latest are injected as
   * search-job time bounds when the SPL does not carry its own.
   */
  async runSearch(spl: string, opts?: { earliestTime?: string; latestTime?: string }): Promise<any[]> {
    let query = spl.trim();
    if (opts?.earliestTime && !/earliest\s*=/.test(query)) {
      query = `${query} earliest=${opts.earliestTime}`;
    }
    if (opts?.latestTime && !/latest\s*=/.test(query)) {
      query = `${query} latest=${opts.latestTime}`;
    }
    return this.withRetry(() => this.runSearchJob(query), 'runSearch');
  }

  private async runSearchJob(spl: string): Promise<any[]> {
    const body = new URLSearchParams({
      search: spl.trim(),
      output_mode: 'json',
      exec_mode: 'oneshot',
    });

    const res = await this.requestText(
      `${this.getRestBaseUrl()}/services/search/jobs/export`,
      'POST',
      {
        'Authorization': this.getSplunkHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body.toString()
    );

    if (!res.ok) {
      if (res.status === 401) throw new Error('Splunk authentication failed (401). Verify the token is valid.');
      if (res.status === 403) throw new Error('Splunk access denied (403). Token lacks search permission.');
      throw new Error(`Splunk search failed: HTTP ${res.status} — ${res.text.slice(0, 200)}`);
    }

    return res.text
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      })
      .map((entry) => entry.result || entry)
      .filter((row) => row && typeof row === 'object' && Object.keys(row).length > 0);
  }
}
