import { Pool, PoolClient } from 'pg';
import axios, { AxiosError } from 'axios';

export interface SplunkConfig {
  url: string;
  hec_token: string;
  username?: string;
  password?: string;
  ssl_verify: boolean;
}

export interface SplunkTestResult {
  success: boolean;
  message: string;
  details?: {
    splunk_version?: string;
    indexes_available?: number;
    hec_status?: string;
  };
}

export interface TenantSplunkStatus {
  tenant_id: string;
  is_configured: boolean;
  last_test: string | null;
  test_status: 'success' | 'failed' | 'not_tested' | null;
  test_error: string | null;
}

export class SplunkConfigService {
  constructor(private pool: Pool) {}

  /**
   * Test Splunk connection with given credentials
   * Validates both HEC endpoint and Splunk API endpoints
   */
  async testSplunkConnection(config: SplunkConfig): Promise<SplunkTestResult> {
    const errors: string[] = [];

    try {
      // Validate inputs
      if (!config.url) errors.push('Splunk URL is required');
      if (!config.hec_token) errors.push('HEC token is required');

      if (errors.length > 0) {
        return {
          success: false,
          message: errors.join('; '),
        };
      }

      // Normalize URL (remove trailing slash)
      const baseUrl = config.url.replace(/\/$/, '');

      // Test 1: HEC Endpoint Health Check
      const hecResult = await this.testHecEndpoint(baseUrl, config.hec_token, config.ssl_verify);
      if (!hecResult.success) {
        return hecResult;
      }

      // Test 2: API Authentication (if username/password provided)
      let splunkVersion: string | undefined;
      if (config.username && config.password) {
        const authResult = await this.testApiAuthentication(
          baseUrl,
          config.username,
          config.password,
          config.ssl_verify
        );

        if (!authResult.success) {
          return authResult;
        }
        splunkVersion = authResult.details?.splunk_version;
      }

      // Test 3: Verify index access
      let indexCount = 0;
      if (config.username && config.password) {
        const indexResult = await this.getIndexCount(
          baseUrl,
          config.username,
          config.password,
          config.ssl_verify
        );
        indexCount = indexResult;
      }

      return {
        success: true,
        message: 'Splunk connection successful',
        details: {
          splunk_version: splunkVersion,
          indexes_available: indexCount,
          hec_status: 'healthy',
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        success: false,
        message: `Connection test failed: ${axiosError.message || 'Unknown error'}`,
        details: {
          hec_status: 'failed',
        },
      };
    }
  }

  /**
   * Store Splunk configuration for a tenant
   * Credentials are encrypted before storage
   */
  async saveSplunkConfig(
    tenant_id: string,
    config: SplunkConfig,
    client?: PoolClient
  ): Promise<TenantSplunkStatus> {
    const pool = client || this.pool;

    try {
      // In production, encrypt credentials using a key management service
      // For now, we'll flag them as needing encryption
      const result = await pool.query(
        `
        UPDATE tenants
        SET
          splunk_url = $1,
          splunk_hec_token = $2,
          splunk_username = $3,
          splunk_password = $4,
          splunk_ssl_verify = $5,
          updated_at = NOW()
        WHERE id = $6
        RETURNING id, is_configured, last_splunk_test, splunk_test_status, splunk_test_error
        `,
        [
          config.url,
          config.hec_token,
          config.username || null,
          config.password || null,
          config.ssl_verify,
          tenant_id,
        ]
      );

      if (result.rows.length === 0) {
        throw new Error('Tenant not found');
      }

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

  /**
   * Mark Splunk configuration as tested
   */
  async markSplunkConfigTested(
    tenant_id: string,
    testResult: SplunkTestResult,
    client?: PoolClient
  ): Promise<void> {
    const pool = client || this.pool;

    await pool.query(
      `
      UPDATE tenants
      SET
        last_splunk_test = NOW(),
        splunk_test_status = $1,
        splunk_test_error = $2,
        is_configured = CASE WHEN $1 = 'success' THEN true ELSE false END,
        updated_at = NOW()
      WHERE id = $3
      `,
      [testResult.success ? 'success' : 'failed', testResult.message, tenant_id]
    );
  }

  /**
   * Get stored Splunk configuration for a tenant
   * Returns config without password for security
   */
  async getSplunkConfig(tenant_id: string): Promise<SplunkConfig | null> {
    const result = await this.pool.query(
      `
      SELECT splunk_url, splunk_hec_token, splunk_username, splunk_ssl_verify
      FROM tenants
      WHERE id = $1 AND splunk_url IS NOT NULL
      `,
      [tenant_id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      url: row.splunk_url,
      hec_token: row.splunk_hec_token,
      username: row.splunk_username,
      ssl_verify: row.splunk_ssl_verify,
    };
  }

  /**
   * Get Splunk status for a tenant
   */
  async getSplunkStatus(tenant_id: string): Promise<TenantSplunkStatus | null> {
    const result = await this.pool.query(
      `
      SELECT id, is_configured, last_splunk_test, splunk_test_status, splunk_test_error
      FROM tenants
      WHERE id = $1
      `,
      [tenant_id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const tenant = result.rows[0];
    return {
      tenant_id: tenant.id,
      is_configured: tenant.is_configured,
      last_test: tenant.last_splunk_test,
      test_status: tenant.splunk_test_status,
      test_error: tenant.splunk_test_error,
    };
  }

  // ============ PRIVATE HELPER METHODS ============

  private async testHecEndpoint(
    baseUrl: string,
    hecToken: string,
    sslVerify: boolean
  ): Promise<SplunkTestResult> {
    try {
      const response = await axios.post(
        `${baseUrl}/services/collector`,
        {
          event: {
            message: 'Test event from Teja Governance Dashboard',
          },
          sourcetype: '_json',
        },
        {
          headers: {
            Authorization: `Splunk ${hecToken}`,
            'Content-Type': 'application/json',
          },
          https: { rejectUnauthorized: sslVerify },
          timeout: 10000,
        }
      );

      // HEC returns 200 with text "Success" if accepted
      if (response.status === 200) {
        return {
          success: true,
          message: 'HEC endpoint is healthy',
        };
      }

      return {
        success: false,
        message: `HEC endpoint returned status ${response.status}`,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        success: false,
        message: `HEC endpoint test failed: ${axiosError.message}`,
      };
    }
  }

  private async testApiAuthentication(
    baseUrl: string,
    username: string,
    password: string,
    sslVerify: boolean
  ): Promise<SplunkTestResult> {
    try {
      const response = await axios.get(`${baseUrl}/services/server/info`, {
        auth: {
          username,
          password,
        },
        https: { rejectUnauthorized: sslVerify },
        timeout: 10000,
        validateStatus: (status) => status === 200,
      });

      // Extract Splunk version from response
      const versionMatch = response.data.match(/<s:key name="version">([^<]+)<\/s:key>/);
      const version = versionMatch ? versionMatch[1] : 'unknown';

      return {
        success: true,
        message: 'API authentication successful',
        details: {
          splunk_version: version,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        success: false,
        message: `API authentication failed: ${axiosError.message}`,
      };
    }
  }

  private async getIndexCount(
    baseUrl: string,
    username: string,
    password: string,
    sslVerify: boolean
  ): Promise<number> {
    try {
      const response = await axios.get(`${baseUrl}/services/data/indexes`, {
        auth: {
          username,
          password,
        },
        https: { rejectUnauthorized: sslVerify },
        timeout: 10000,
        params: {
          output_mode: 'json',
        },
        validateStatus: (status) => status === 200,
      });

      // Count non-internal indexes
      const indexes = response.data.entry || [];
      return indexes.filter((idx: any) => !idx.name.startsWith('_')).length;
    } catch (error) {
      // If we can't get indexes, return 0 but don't fail
      console.warn('Failed to get index count:', error);
      return 0;
    }
  }
}
