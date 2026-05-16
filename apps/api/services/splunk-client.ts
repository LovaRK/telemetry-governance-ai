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

export class SplunkClient {
  private config: SplunkMCPConfig;

  constructor(config: SplunkMCPConfig) {
    if (!config.mcpUrl) throw new Error('Splunk MCP URL is required');
    // Normalize URL: strip whitespace, ensure proper protocol
    let normalized = config.mcpUrl.trim();
    // Remove common key prefixes accidentally typed: "url:", "url-", "mcpUrl", etc.
    normalized = normalized.replace(/^(url|mcpUrl|mcp_url|splunk)[:\-]?\s*/i, '');
    // Strip any non-http prefix that isn't a valid protocol
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `http://${normalized}`;
    }
    this.config = { ...config, mcpUrl: normalized };
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs ?? 20000;
  }

  private getTokenValue(): string {
    return this.config.token
      .trim()
      .replace(/^Authorization:\s*/i, '')
      .replace(/^(Bearer|Splunk)\s+/i, '')
      .trim();
  }

  private getBearerHeader(): string {
    return `Bearer ${this.getTokenValue()}`;
  }

  private getSplunkHeader(): string {
    return `Splunk ${this.getTokenValue()}`;
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

      const data = JSON.parse(res.text);
      const entries: any[] = data.entry || [];

      // Filter out internal Splunk indexes (start with _)
      return entries
        .filter(e => e.name && !e.name.startsWith('_'))
        .map(e => {
          const content = e.content || {};
          const currentSizeMB = parseFloat(content.currentDBSizeMB || content.maxTotalDataSizeMB || '0');
          const retentionSecs = parseInt(content.frozenTimePeriodInSecs || '7776000', 10);
          const retentionDays = Math.max(1, Math.round(retentionSecs / 86400));
          const dailyAvgGb = currentSizeMB > 0 ? parseFloat((currentSizeMB / 1024 / retentionDays).toFixed(4)) : 0;

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

      const data = JSON.parse(res.text);
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
