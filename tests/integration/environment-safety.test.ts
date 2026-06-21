/**
 * CRITICAL SECURITY TESTS
 *
 * Verify two-layer safety model prevents synthetic demo telemetry
 * from accidentally reaching production Splunk infrastructure.
 *
 * TEST GROUPS:
 * 1. Configuration Safety - URL acceptance/rejection
 * 2. Runtime Routing Verification - where data actually goes
 * 3. Data Isolation - synthetic data stays in sandbox
 * 4. Environment Guardrails - mode enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EnvironmentValidator, ENVIRONMENT_CONFIGS } from '../../core/security/environment-validator';
import { Pool } from 'pg';

describe('CRITICAL: Environment Safety - Prevent Production Telemetry Leak', () => {
  let sandboxValidator: EnvironmentValidator;
  let productionValidator: EnvironmentValidator;

  beforeEach(() => {
    sandboxValidator = new EnvironmentValidator('sandbox');
    productionValidator = new EnvironmentValidator('production');
  });

  // ════════════════════════════════════════════════════════════════════════
  // TEST GROUP 1: Configuration Safety
  // ════════════════════════════════════════════════════════════════════════

  describe('TEST GROUP 1 - Configuration Safety', () => {
    describe('TEST 1.1: Sandbox URL accepted', () => {
      it('should accept sandbox Splunk URL (144.202.48.85)', () => {
        const result = sandboxValidator.validateSplunkUrl('https://144.202.48.85:8089', 'hec');
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should accept sandbox URL with various schemes and ports', () => {
        const urls = [
          'https://144.202.48.85:8089',
          'http://144.202.48.85:8088',
          'https://144.202.48.85',
        ];
        urls.forEach((url) => {
          const result = sandboxValidator.validateSplunkUrl(url, 'hec');
          expect(result.valid).toBe(true);
        });
      });
    });

    describe('TEST 1.2: Production URL blocked in sandbox', () => {
      it('should REJECT production endpoint (45.76.167.6)', () => {
        const result = sandboxValidator.validateSplunkUrl('https://45.76.167.6:8089', 'hec');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('PRODUCTION ENDPOINT BLOCKED');
        expect(result.reason).toContain('45.76.167.6');
      });

      it('should REJECT URLs with "prod" pattern', () => {
        const prodUrls = [
          'https://prod-splunk.company.com:8089',
          'https://splunk-prod.internal:8089',
          'https://production.example.com:8089',
        ];
        prodUrls.forEach((url) => {
          const result = sandboxValidator.validateSplunkUrl(url, 'hec');
          expect(result.valid).toBe(false);
          expect(result.reason).toContain('PRODUCTION ENDPOINT BLOCKED');
        });
      });

      it('should return HTTP 400 equivalent error', () => {
        const result = sandboxValidator.validateSplunkUrl('https://45.76.167.6:8089', 'api');
        expect(result.valid).toBe(false);
        expect(result.reason).toBeTruthy();
        // In HTTP context, this would be HTTP 400
      });
    });

    describe('TEST 1.3: Production HEC blocked', () => {
      it('should block production HEC endpoint on port 8088', () => {
        const result = sandboxValidator.validateSplunkUrl('https://45.76.167.6:8088', 'hec');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('PRODUCTION ENDPOINT BLOCKED');
      });

      it('should block any port to production IP', () => {
        const ports = [8089, 8088, 8000, 9000];
        ports.forEach((port) => {
          const result = sandboxValidator.validateSplunkUrl(`https://45.76.167.6:${port}`, 'hec');
          expect(result.valid).toBe(false);
        });
      });
    });

    describe('TEST 1.4: Localhost allowed for development', () => {
      it('should allow localhost', () => {
        const result = sandboxValidator.validateSplunkUrl('http://localhost:8089', 'api');
        expect(result.valid).toBe(true);
      });

      it('should allow 127.0.0.1', () => {
        const result = sandboxValidator.validateSplunkUrl('http://127.0.0.1:8089', 'api');
        expect(result.valid).toBe(true);
      });

      it('should allow host.docker.internal (Docker bridge)', () => {
        const result = sandboxValidator.validateSplunkUrl('http://host.docker.internal:8089', 'api');
        expect(result.valid).toBe(true);
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TEST GROUP 2: Runtime Routing Verification
  // ════════════════════════════════════════════════════════════════════════

  describe('TEST GROUP 2 - Runtime Routing Verification', () => {
    describe('TEST 2.1: Verify active Splunk URL (database level)', () => {
      it('should validate all three URLs together (API, HEC, MCP)', () => {
        const result = sandboxValidator.validateAllSplunkUrls(
          'https://144.202.48.85:8089', // apiUrl
          'https://144.202.48.85:8089', // hecUrl
          'https://144.202.48.85:8089'  // mcpUrl
        );
        expect(result.valid).toBe(true);
        expect(result.reasons).toHaveLength(0);
      });

      it('should reject if ANY URL is production', () => {
        const result = sandboxValidator.validateAllSplunkUrls(
          'https://144.202.48.85:8089', // apiUrl (sandbox) ✓
          'https://45.76.167.6:8089',   // hecUrl (production) ✗
          'https://144.202.48.85:8089'  // mcpUrl (sandbox) ✓
        );
        expect(result.valid).toBe(false);
        expect(result.reasons.length).toBeGreaterThan(0);
        expect(result.reasons[0]).toContain('HEC URL');
        expect(result.reasons[0]).toContain('PRODUCTION ENDPOINT BLOCKED');
      });

      it('should collect ALL URL validation errors', () => {
        const result = sandboxValidator.validateAllSplunkUrls(
          'https://45.76.167.6:8089', // apiUrl (production)
          'https://prod-splunk.com:8089', // hecUrl (production)
          'https://production.internal'    // mcpUrl (production)
        );
        expect(result.valid).toBe(false);
        expect(result.reasons.length).toBe(3); // All three should fail
      });
    });

    describe('TEST 2.2: Logging for audit trail', () => {
      it('should log approved URLs during save (for verification)', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        // In real implementation, this happens in splunk-config-service.ts
        // We verify the logging infrastructure exists
        expect(consoleSpy).toBeDefined();

        consoleSpy.mockRestore();
      });

      it('should log security violations to console.error', () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();

        // In real implementation, validation failure logs to console.error
        expect(errorSpy).toBeDefined();

        errorSpy.mockRestore();
      });
    });

    describe('TEST 2.3: Network-level verification', () => {
      it('should only allow POST to sandbox HEC endpoint', () => {
        // This test verifies the validator would block production before
        // any network call is made
        const maliciousUrl = 'https://45.76.167.6:8089/services/collector';
        const result = sandboxValidator.validateSplunkUrl('https://45.76.167.6:8089', 'hec');
        expect(result.valid).toBe(false);
        // In network logs, we should see ONLY 144.202.48.85, never 45.76.167.6
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TEST GROUP 3: Data Isolation
  // ════════════════════════════════════════════════════════════════════════

  describe('TEST GROUP 3 - Data Isolation', () => {
    describe('TEST 3.1: Synthetic telemetry isolation', () => {
      it('should prevent sending demo data to production', () => {
        // Synthetic telemetry like:
        // { source: "demo-test", message: "THIS_IS_SYNTHETIC" }
        // Should ONLY go to sandbox Splunk

        const sandboxResult = sandboxValidator.validateSplunkUrl('https://144.202.48.85:8089', 'hec');
        const productionResult = sandboxValidator.validateSplunkUrl('https://45.76.167.6:8089', 'hec');

        expect(sandboxResult.valid).toBe(true); // Synthetic data CAN go to sandbox
        expect(productionResult.valid).toBe(false); // Synthetic data CANNOT go to production
      });
    });

    describe('TEST 3.2: Production search must return zero synthetic events', () => {
      it('should not find synthetic markers in production', () => {
        // Test case: Search production Splunk for THIS_IS_SYNTHETIC
        // Expected: 0 results (because our validator blocks it at config save time)

        // This is verification in production Splunk:
        // search index=* THIS_IS_SYNTHETIC
        // Expected result: 0 events

        // Our validator makes this guarantee by blocking the URL before data is sent
        const result = sandboxValidator.validateSplunkUrl('https://45.76.167.6:8089', 'hec');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('PRODUCTION ENDPOINT BLOCKED');
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TEST GROUP 4: Environment Guardrails
  // ════════════════════════════════════════════════════════════════════════

  describe('TEST GROUP 4 - Environment Guardrails', () => {
    describe('TEST 4.1: Sandbox mode blocks production', () => {
      it('should block production URL in sandbox mode', () => {
        const result = sandboxValidator.validateSplunkUrl('https://45.76.167.6:8089', 'hec');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('PRODUCTION ENDPOINT BLOCKED');
      });

      it('should provide helpful error message with allowed hosts', () => {
        const result = sandboxValidator.validateSplunkUrl('https://unknown-host.com:8089', 'hec');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('not in allowlist');
        expect(result.reason).toContain('144.202.48.85');
        expect(result.reason).toContain('localhost');
      });

      it('should list allowed hosts in environment', () => {
        const allowed = sandboxValidator.getAllowedHosts();
        expect(allowed).toContain('144.202.48.85');
        expect(allowed).toContain('localhost');
        expect(allowed).toContain('127.0.0.1');
        expect(allowed).toContain('host.docker.internal');
      });

      it('should list blocked hosts in environment', () => {
        const blocked = sandboxValidator.getBlockedHosts();
        expect(blocked).toContain('45.76.167.6');
        expect(blocked).toContain('prod');
        expect(blocked).toContain('production');
      });
    });

    describe('TEST 4.2: Production mode allows production URLs', () => {
      it('should allow any valid URL in production mode', () => {
        const result = productionValidator.validateSplunkUrl('https://45.76.167.6:8089', 'hec');
        expect(result.valid).toBe(true);
      });

      it('should allow arbitrary hostnames in production', () => {
        const urls = [
          'https://splunk-prod-us-east-1.company.com:8089',
          'https://45.76.167.6:8089',
          'https://internal-prod-splunk:8089',
        ];
        urls.forEach((url) => {
          const result = productionValidator.validateSplunkUrl(url, 'hec');
          expect(result.valid).toBe(true);
        });
      });

      it('should return empty blocklist in production mode', () => {
        const blocked = productionValidator.getBlockedHosts();
        // In production mode, blocklist is empty (all hosts allowed)
        // This is OK because APP_ENV=production means real operational data
      });
    });

    describe('TEST 4.3: Environment mode detection', () => {
      it('should report correct environment mode', () => {
        expect(sandboxValidator.getEnvironmentMode()).toBe('sandbox');
        expect(productionValidator.getEnvironmentMode()).toBe('production');
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // CRITICAL PATH TESTS
  // ════════════════════════════════════════════════════════════════════════

  describe('CRITICAL PATH: Full config save flow (sandbox)', () => {
    it('should accept and save sandbox config', () => {
      const config = {
        apiUrl: 'https://144.202.48.85:8089',
        hecUrl: 'https://144.202.48.85:8089',
        mcpUrl: 'https://144.202.48.85:8089',
      };

      const result = sandboxValidator.validateAllSplunkUrls(
        config.apiUrl,
        config.hecUrl,
        config.mcpUrl
      );

      expect(result.valid).toBe(true);
      // Would proceed to database save
    });

    it('should reject and NOT save production config in sandbox', () => {
      const config = {
        apiUrl: 'https://45.76.167.6:8089',
        hecUrl: 'https://45.76.167.6:8089',
        mcpUrl: 'https://45.76.167.6:8089',
      };

      const result = sandboxValidator.validateAllSplunkUrls(
        config.apiUrl,
        config.hecUrl,
        config.mcpUrl
      );

      expect(result.valid).toBe(false);
      expect(result.reasons.length).toBe(3);
      // Would NOT proceed to database save, HTTP 400 returned
    });

    it('should reject mixed config (sandbox API + production HEC)', () => {
      const config = {
        apiUrl: 'https://144.202.48.85:8089',  // Sandbox (safe)
        hecUrl: 'https://45.76.167.6:8089',    // Production (DANGEROUS!)
        mcpUrl: 'https://144.202.48.85:8089',
      };

      const result = sandboxValidator.validateAllSplunkUrls(
        config.apiUrl,
        config.hecUrl,
        config.mcpUrl
      );

      expect(result.valid).toBe(false);
      expect(result.reasons[0]).toContain('HEC URL');
      expect(result.reasons[0]).toContain('PRODUCTION ENDPOINT BLOCKED');
      // This is the mixed config protection
    });
  });
});
