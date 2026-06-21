/**
 * Environment-aware URL validator for multi-tenant safety.
 *
 * CRITICAL: Prevents demo/synthetic telemetry from reaching production Splunk.
 *
 * Layer 1: Runtime environment separation (APP_ENV)
 * Layer 2: Explicit host allowlist (whitelist, not blacklist)
 */

export type AppEnvironment = 'sandbox' | 'production';

export interface EnvironmentConfig {
  appEnv: AppEnvironment;
  allowedHosts: string[];
  blockedHosts: string[];
}

/**
 * SANDBOX MODE: Only approved hosts allowed
 * PRODUCTION MODE: All hosts allowed (for real operational use)
 */
export const ENVIRONMENT_CONFIGS: Record<AppEnvironment, EnvironmentConfig> = {
  sandbox: {
    appEnv: 'sandbox',
    // ALLOWLIST: Only these hosts permitted in sandbox
    allowedHosts: [
      '144.202.48.85',      // Sandbox Splunk (legacy)
      'splunk-mock',        // Docker mock Splunk (no license restrictions)
      'localhost',          // Local testing
      '127.0.0.1',          // Loopback
      'host.docker.internal', // Docker host access
      '0.0.0.0',            // Wildcard (for local dev)
    ],
    // BLOCKLIST: Explicitly prevent these hosts (defense in depth)
    blockedHosts: [
      '45.76.167.6',        // PRODUCTION Splunk (NEVER in sandbox)
      'prod',
      'production',
      'sem',
      'splunk-prod',
    ],
  },
  production: {
    appEnv: 'production',
    // In production mode, any valid URL is allowed
    allowedHosts: [],
    blockedHosts: [],
  },
};

export class EnvironmentValidator {
  private config: EnvironmentConfig;

  constructor(appEnv: AppEnvironment = 'sandbox') {
    this.config = ENVIRONMENT_CONFIGS[appEnv];
  }

  /**
   * Validate a Splunk URL against environment restrictions.
   * CRITICAL: Called before persisting any config change.
   *
   * Returns: { valid: boolean, reason?: string }
   */
  validateSplunkUrl(urlString: string, purpose: 'api' | 'hec' | 'mcp'): { valid: boolean; reason?: string } {
    if (!urlString) {
      return { valid: false, reason: 'URL cannot be empty' };
    }

    // Parse URL safely
    let url: URL;
    try {
      url = new URL(urlString);
    } catch (err) {
      return { valid: false, reason: `Invalid URL format: ${(err as Error).message}` };
    }

    const hostname = url.hostname.toLowerCase();

    // SANDBOX MODE: Strict allowlist enforcement
    if (this.config.appEnv === 'sandbox') {
      // Check against blocklist first (fail-fast for dangerous hosts)
      for (const blocked of this.config.blockedHosts) {
        if (hostname.includes(blocked.toLowerCase())) {
          return {
            valid: false,
            reason: `🚫 PRODUCTION ENDPOINT BLOCKED in sandbox mode\nHost "${hostname}" is not allowed. Blocked pattern: "${blocked}"\nSandbox can ONLY use: ${this.config.allowedHosts.join(', ')}`,
          };
        }
      }

      // Check against allowlist (strict whitelist)
      const isAllowed = this.config.allowedHosts.some((allowed) =>
        hostname === allowed.toLowerCase() ||
        hostname.endsWith(`.${allowed.toLowerCase()}`)
      );

      if (!isAllowed) {
        return {
          valid: false,
          reason: `🔒 SANDBOX RESTRICTION: Host "${hostname}" not in allowlist\nApproved hosts: ${this.config.allowedHosts.join(', ')}`,
        };
      }

      return { valid: true };
    }

    // PRODUCTION MODE: Allow all valid URLs
    return { valid: true };
  }

  /**
   * Validate all three Splunk URLs together.
   * Ensures no mixed production/sandbox configuration.
   */
  validateAllSplunkUrls(apiUrl?: string, hecUrl?: string, mcpUrl?: string): { valid: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (apiUrl) {
      const result = this.validateSplunkUrl(apiUrl, 'api');
      if (!result.valid) reasons.push(`API URL: ${result.reason}`);
    }

    if (hecUrl) {
      const result = this.validateSplunkUrl(hecUrl, 'hec');
      if (!result.valid) reasons.push(`HEC URL: ${result.reason}`);
    }

    if (mcpUrl) {
      const result = this.validateSplunkUrl(mcpUrl, 'mcp');
      if (!result.valid) reasons.push(`MCP URL: ${result.reason}`);
    }

    return {
      valid: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Get current environment mode for logging/UI display
   */
  getEnvironmentMode(): AppEnvironment {
    return this.config.appEnv;
  }

  /**
   * Get allowlist for UI/logging purposes
   */
  getAllowedHosts(): string[] {
    return [...this.config.allowedHosts];
  }

  /**
   * Get blocklist for UI/logging purposes
   */
  getBlockedHosts(): string[] {
    return [...this.config.blockedHosts];
  }
}

/**
 * Singleton instance using APP_ENV from environment
 */
const APP_ENV = (process.env.APP_ENV || 'sandbox') as AppEnvironment;
export const environmentValidator = new EnvironmentValidator(APP_ENV);
