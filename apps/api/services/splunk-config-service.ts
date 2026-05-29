import { Pool, PoolClient } from 'pg';
import fetch from 'node-fetch';
import https from 'https';
import { encryptSecret, decryptSecret } from '../../../core/security/secret-manager';
import { environmentValidator } from '../../../core/security/environment-validator';
import { governanceEngine, Decision, GovernanceDecision } from '../../../core/governance/engine';
import { isGovernanceEnforcing, isGovernanceActive } from '../../../core/governance/governance-mode';
import {
  recordClassifiedMismatch,
  recordShadowConsensusMatch,
  MismatchType
} from '../../../core/governance/governance-metrics';

export interface SplunkConfig {
  url?: string;
  apiUrl?: string;
  hecUrl?: string;
  mcpUrl?: string;
  hec_token: string | null;
  username?: string;
  password?: string;
  ssl_verify: boolean;
  restAuthType?: 'JWT' | 'BASIC' | 'TOKEN';
  restAuthSecret?: string;
  restAuthSecretVersion?: number;
}

export interface SplunkTestResult {
  success: boolean;
  message: string;
  details?: {
    splunk_version?: string;
    indexes_available?: number;
    hec_status?: string;
    api_status?: string;
  };
}

export interface TenantSplunkStatus {
  tenant_id: string;
  is_configured: boolean;
  last_test: string | null;
  test_status: 'success' | 'failed' | 'not_tested' | null;
  test_error: string | null;
}

function buildRestAuthHeader(config: SplunkConfig): string | null {
  if (!config.restAuthSecret) return null;
  if (config.restAuthType === 'JWT') return `Bearer ${config.restAuthSecret}`;
  if (config.restAuthType === 'BASIC' && config.username && config.password) {
    return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }
  if (config.restAuthType === 'TOKEN') return `Bearer ${config.restAuthSecret}`;
  if (config.username && config.password) {
    return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }
  return null;
}

export class SplunkConfigService {
  constructor(private _pool: Pool) {}

  get pool(): Pool { return this._pool; }

  async testSplunkConnection(config: SplunkConfig): Promise<SplunkTestResult> {
    const errors: string[] = [];
    if (!config.apiUrl && !config.url) errors.push('Splunk API URL is required');
    if (!config.hecUrl && !config.url) errors.push('Splunk HEC URL is required');
    // HEC token is optional - only required if testing HEC endpoint
    if (errors.length > 0) {
      return { success: false, message: errors.join('; ') };
    }

    const apiUrl = (config.apiUrl || config.url || '').replace(/\/$/, '');
    const hecUrl = (config.hecUrl || config.url || '').replace(/\/$/, '');

    // Only test HEC endpoint if HEC token is provided
    if (config.hec_token) {
      const hecResult = await this.testHecEndpoint(hecUrl, config.hec_token, config.ssl_verify);
      if (!hecResult.success) return hecResult;
    }

    let apiStatus: string | undefined;
    let hecStatus: string | undefined = config.hec_token ? 'healthy' : 'not_configured';
    let splunkVersion: string | undefined;
    const authHeader = buildRestAuthHeader(config);
    if (authHeader) {
      const authResult = await this.testApiAuthentication(apiUrl, authHeader, config.ssl_verify);
      apiStatus = authResult.success ? 'healthy' : 'failed';
      if (authResult.success) splunkVersion = authResult.details?.splunk_version;
      if (!authResult.success) {
        return authResult;
      }
    }

    let indexCount = 0;
    if (authHeader) {
      indexCount = await this.getIndexCount(apiUrl, authHeader, config.ssl_verify);
    }

    return {
      success: true,
      message: 'Splunk connection successful',
      details: { splunk_version: splunkVersion, indexes_available: indexCount, hec_status: hecStatus, api_status: apiStatus },
    };
  }

  async saveSplunkConfig(
    tenant_id: string,
    config: SplunkConfig,
    client?: PoolClient,
    requestContext?: {
      trace_id?: string;
      correlation_id?: string;
      causation_id?: string;
      actor_id?: string;
      actor_type?: 'human' | 'agent' | 'service';
    }
  ): Promise<TenantSplunkStatus> {
    const pool = client || this._pool;
    try {
      // SECURITY: Validate URLs against environment restrictions (Layer 1 & 2)
      const urlValidation = environmentValidator.validateAllSplunkUrls(
        config.apiUrl || config.url,
        config.hecUrl || config.url,
        config.mcpUrl
      );

      if (!urlValidation.valid) {
        const error = new Error(`URL Validation Failed (${environmentValidator.getEnvironmentMode()} mode):\n${urlValidation.reasons.join('\n')}`);
        console.error('[SECURITY]', error.message);
        throw error;
      }

      // PHASE 2A: Governance evaluation (mode-controlled)
      // Shadow mode: RGE in parallel with old validator (observational)
      // Enforcing mode: RGE authoritative (fail-closed)
      // Disabled mode: No governance evaluation
      let rgeDecision: GovernanceDecision | null = null;
      try {
        if (isGovernanceActive() && requestContext?.trace_id && requestContext?.correlation_id) {
          rgeDecision = governanceEngine.evaluate({
            action: 'SAVE_SPLUNK_CONFIG',
            actor_id: requestContext.actor_id || tenant_id,
            actor_type: requestContext.actor_type || 'human',
            resource: `splunk:config:${config.apiUrl || config.url || 'unknown'}:8089`,
            trace_id: requestContext.trace_id,
            correlation_id: requestContext.correlation_id,
            causation_id: requestContext.causation_id,
            policy_snapshot_hash: 'policy-v1-phase-2a'
          });

          // Determine if there's a mismatch between RGE and old validator
          const rgeDecisionStr = String(rgeDecision.decision);
          const oldValidatorDecisionStr = urlValidation.valid ? 'ALLOW' : 'DENY';
          const hasMismatch = rgeDecisionStr !== oldValidatorDecisionStr;

          // Log RGE decision with semantic observability (not just boolean comparison)
          console.log('[GOVERNANCE_DECISION]', {
            trace_id: requestContext.trace_id,
            correlation_id: requestContext.correlation_id,

            // RGE decision (semantic detail for mismatch debugging)
            rge_decision: rgeDecisionStr,
            rge_risk_level: rgeDecision.risk_level,
            rge_matched_policies: rgeDecision.matched_policy_ids,
            rge_enforcement_mode: rgeDecision.enforcement_mode,
            rge_reasons: rgeDecision.reasons,

            // Old validator (for comparison)
            old_validator_decision: oldValidatorDecisionStr,
            old_validator_reasons: urlValidation.reasons,

            // Input identity (for forensic grouping and replay)
            input_fingerprint: rgeDecision.input_fingerprint,
            normalized_resource: rgeDecision.resource,

            // Mismatch detection (semantic)
            mismatch: hasMismatch,

            // Environment context
            environment: governanceEngine.getEnvironment(),
            actor_id: rgeDecision.actor_id,
            action: rgeDecision.action,

            // Metadata
            decision_id: rgeDecision.decision_id,
            created_at: rgeDecision.created_at
          });

          // Record mismatch or consensus for metrics
          // CRITICAL: This enables shadow_consensus_rate calculation
          if (hasMismatch) {
            // Classify the mismatch type (for sophisticated debugging)
            // Phase 2A: Only policy/environment mismatches possible
            const mismatchType = rgeDecision.risk_level === 'CRITICAL'
              ? MismatchType.ENVIRONMENT  // Environment isolation is critical in Phase 2A
              : MismatchType.POLICY;      // Shouldn't happen in Phase 2A, but categorize if it does

            recordClassifiedMismatch(
              mismatchType,
              rgeDecisionStr,
              oldValidatorDecisionStr,
              governanceEngine.getEnvironment()
            );
          } else {
            // Decisions match: record consensus
            recordShadowConsensusMatch(governanceEngine.getEnvironment());
          }

          // Enforcement: Controlled by GovernanceMode (not commented code)
          if (isGovernanceEnforcing() && rgeDecision.decision === Decision.DENY) {
            // Enforcing mode: RGE DENY blocks execution (fail-closed)
            throw new Error(
              `[GOVERNANCE_DENIED] ${rgeDecision.reasons.join('; ')} ` +
              `(decision_id: ${rgeDecision.decision_id}, risk_level: ${rgeDecision.risk_level})`
            );
          }
          // Shadow mode: RGE DENY is logged but does not block (observational)
        }
      } catch (rgeError) {
        // RGE evaluation failed
        if (isGovernanceEnforcing()) {
          // Enforcing mode: RGE failure is fail-closed (block execution)
          throw new Error(
            `[GOVERNANCE_EVALUATION_FAILED] ${(rgeError as Error).message} ` +
            `(fail-closed: governance unavailable)`
          );
        } else {
          // Shadow/disabled mode: Log error but don't block
          console.error('[GOVERNANCE_EVALUATION_ERROR]', {
            error: (rgeError as Error).message,
            trace_id: requestContext?.trace_id,
            mode: isGovernanceEnforcing() ? 'ENFORCING' : 'SHADOW',
            timestamp: new Date().toISOString()
          });
          // Continue executing - don't fail on RGE errors in shadow mode
        }
      }

      // Log approved URLs for audit trail (TEST 2.2)
      console.log('[SPLUNK_CONFIG_SAVE]', {
        tenant_id,
        environment: environmentValidator.getEnvironmentMode(),
        apiUrl: config.apiUrl || config.url,
        hecUrl: config.hecUrl || config.url,
        mcpUrl: config.mcpUrl,
        trace_id: requestContext?.trace_id,
        rge_decision: rgeDecision?.decision,
        timestamp: new Date().toISOString(),
      });

      let encryptedSecret: string | null = null;
      if (config.restAuthSecret) {
        encryptedSecret = encryptSecret(config.restAuthSecret);
      } else {
        const existing = await pool.query(
          `SELECT splunk_rest_auth_secret FROM tenants WHERE id = $1`,
          [tenant_id]
        );
        if (existing.rows.length > 0) encryptedSecret = existing.rows[0].splunk_rest_auth_secret;
      }

      const hasSecret = typeof encryptedSecret === 'string' && encryptedSecret.length > 0;
      const result = await pool.query(
        `UPDATE tenants SET
          splunk_api_url = $1, splunk_hec_url = $2, splunk_mcp_url = $3,
          splunk_hec_token = $4, splunk_username = $5, splunk_password = $6,
          splunk_ssl_verify = $7,
          splunk_rest_auth_type = $8, splunk_rest_auth_secret = $9,
          splunk_rest_auth_secret_version = CASE WHEN $10 THEN COALESCE(splunk_rest_auth_secret_version, 0) + 1 ELSE splunk_rest_auth_secret_version END,
          splunk_rest_auth_updated_at = CASE WHEN $10 THEN NOW() ELSE splunk_rest_auth_updated_at END,
          updated_at = NOW()
        WHERE id = $11
        RETURNING id, is_configured, last_splunk_test, splunk_test_status, splunk_test_error`,
        [
          config.apiUrl || config.url || null,
          config.hecUrl || config.url || null,
          config.mcpUrl || null,
          config.hec_token,
          config.username || null,
          config.password || null,
          config.ssl_verify,
          config.restAuthType || null,
          hasSecret ? encryptedSecret : null,
          hasSecret,
          tenant_id,
        ]
      );

      if (result.rows.length === 0) throw new Error('Tenant not found');
      const tenant = result.rows[0];
      return {
        tenant_id,
        is_configured: tenant.is_configured,
        last_test: tenant.last_splunk_test,
        test_status: tenant.splunk_test_status,
        test_error: tenant.splunk_test_error,
      };
    } catch (error) {
      throw new Error(`Failed to save Splunk config: ${(error as Error).message}`);
    }
  }

  async markSplunkConfigTested(
    tenant_id: string,
    testResult: SplunkTestResult,
    client?: PoolClient
  ): Promise<void> {
    const pool = client || this._pool;
    await pool.query(
      `UPDATE tenants SET
        last_splunk_test = NOW(),
        splunk_test_status = $1,
        splunk_test_error = $2,
        is_configured = CASE WHEN $1 = 'success' THEN true ELSE false END,
        updated_at = NOW()
      WHERE id = $3`,
      [testResult.success ? 'success' : 'failed', testResult.message, tenant_id]
    );
  }

  async getSplunkConfig(tenant_id: string): Promise<SplunkConfig | null> {
    const result = await this._pool.query(
      `SELECT splunk_url, splunk_api_url, splunk_hec_url, splunk_mcp_url,
              splunk_hec_token, splunk_username, splunk_password, splunk_ssl_verify,
              splunk_rest_auth_type, splunk_rest_auth_secret, splunk_rest_auth_secret_version
       FROM tenants
       WHERE id = $1 AND (splunk_url IS NOT NULL OR splunk_api_url IS NOT NULL)`,
      [tenant_id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    let decryptedSecret: string | undefined;
    if (row.splunk_rest_auth_secret) {
      try {
        decryptedSecret = decryptSecret(row.splunk_rest_auth_secret);
      } catch {
        decryptedSecret = undefined;
      }
    }

    return {
      url: row.splunk_url,
      apiUrl: row.splunk_api_url || row.splunk_url,
      hecUrl: row.splunk_hec_url || row.splunk_url,
      mcpUrl: row.splunk_mcp_url,
      hec_token: row.splunk_hec_token,
      username: row.splunk_username,
      password: row.splunk_password,
      ssl_verify: row.splunk_ssl_verify,
      restAuthType: row.splunk_rest_auth_type,
      restAuthSecret: decryptedSecret,
      restAuthSecretVersion: row.splunk_rest_auth_secret_version,
    };
  }

  async getSplunkStatus(tenant_id: string): Promise<TenantSplunkStatus | null> {
    const result = await this._pool.query(
      `SELECT id, is_configured, last_splunk_test, splunk_test_status, splunk_test_error
       FROM tenants WHERE id = $1`,
      [tenant_id]
    );
    if (result.rows.length === 0) return null;
    const t = result.rows[0];
    return {
      tenant_id: t.id,
      is_configured: t.is_configured,
      last_test: t.last_splunk_test,
      test_status: t.splunk_test_status,
      test_error: t.splunk_test_error,
    };
  }

  private async testHecEndpoint(
    baseUrl: string,
    hecToken: string,
    sslVerify: boolean
  ): Promise<SplunkTestResult> {
    try {
      const response = await fetch(`${baseUrl}/services/collector`, {
        method: 'POST',
        headers: { Authorization: `Splunk ${hecToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: 'Test event from Dashboard' }, sourcetype: '_json' }),
        agent: new https.Agent({ rejectUnauthorized: sslVerify }),
      });
      if (response.status === 200) return { success: true, message: 'HEC endpoint is healthy' };
      return { success: false, message: `HEC endpoint returned status ${response.status}` };
    } catch (error) {
      return { success: false, message: `HEC endpoint test failed: ${(error as Error).message}` };
    }
  }

  private async testApiAuthentication(
    baseUrl: string,
    authHeader: string,
    sslVerify: boolean
  ): Promise<SplunkTestResult> {
    try {
      const response = await fetch(`${baseUrl}/services/server/info`, {
        headers: { Authorization: authHeader },
        agent: new https.Agent({ rejectUnauthorized: sslVerify }),
      });
      if (!response.ok) {
        return { success: false, message: `API authentication failed: HTTP ${response.status}` };
      }
      const text = await response.text();
      const versionMatch = text.match(/<s:key name="version">([^<]+)<\/s:key>/);
      return {
        success: true,
        message: 'API authentication successful',
        details: { splunk_version: versionMatch ? versionMatch[1] : 'unknown' },
      };
    } catch (error) {
      return { success: false, message: `API authentication failed: ${(error as Error).message}` };
    }
  }

  private async getIndexCount(
    baseUrl: string,
    authHeader: string,
    sslVerify: boolean
  ): Promise<number> {
    try {
      const response = await fetch(`${baseUrl}/services/data/indexes?output_mode=json`, {
        headers: { Authorization: authHeader },
        agent: new https.Agent({ rejectUnauthorized: sslVerify }),
      });
      if (!response.ok) return 0;
      const payload = (await response.json()) as any;
      const entries: any[] = payload.entry || [];
      return entries.filter((idx: any) => idx.name && !idx.name.startsWith('_')).length;
    } catch {
      return 0;
    }
  }
}
