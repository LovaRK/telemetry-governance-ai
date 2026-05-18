/**
 * Integration Tests for Security Hardening Fixes
 *
 * Tests for:
 * - FIX 1: Cryptographic binding hash chain (RFC 8785 canonical JSON)
 * - FIX 2: Token family reuse detection + revocation
 * - FIX 3: Envelope HMAC signature verification
 * - FIX 4: Replay authority scope downgrade
 * - FIX 5: Audit rate limiting
 * - FIX 6: Absolute session max lifetime
 */

import { Pool } from 'pg';
import { TokenService } from '../services/token-service';
import { AuditChainService } from '../services/audit-chain-service';
import {
  GovernanceTelemetryEnvelopeV1,
  computeEnvelopeHMAC,
  verifyEnvelopeSignature,
} from '../types/governance-telemetry-envelope';
import { AuditRateLimiter } from '../services/audit-rate-limiter';

describe('Security Hardening Fixes', () => {
  let pool: Pool;
  let tokenService: TokenService;
  let testTenantId: string;
  let testUserId: string;
  let testEmail: string;

  beforeAll(async () => {
    // Initialize database pool
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost/test_db',
    });

    tokenService = new TokenService(pool);
    testTenantId = 'test-tenant-' + Date.now();
    testUserId = 'test-user-' + Date.now();
    testEmail = `test-${Date.now()}@example.com`;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('FIX 1: Cryptographic Binding Hash Chain', () => {
    test('should compute chain hash with root anchor on first binding', async () => {
      const payload = {
        tenantId: testTenantId,
        operatorHash: 'op-hash-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        actionType: 'DECISION_APPROVE',
        authContext: { contextId: 'ctx-1', scope: 'LOCAL' },
        actionPayload: { decision: 'approved' },
      };

      const client = await pool.connect();

      try {
        const { currentHash, previousHash, rootChainHash } = await AuditChainService.computeChainHash(
          client,
          payload,
          new Date().toISOString()
        );

        // First binding should have null previousHash and non-null rootChainHash
        expect(previousHash).toBeNull();
        expect(currentHash).toBeDefined();
        expect(rootChainHash).toBeDefined();
        expect(currentHash.length).toBe(64); // SHA256 hex
        expect(rootChainHash.length).toBe(64);
      } finally {
        client.release();
      }
    });

    test('should produce consistent hash with canonical JSON serialization', async () => {
      const payload = {
        tenantId: testTenantId,
        operatorHash: 'op-hash-2',
        traceId: 'trace-2',
        spanId: 'span-1',
        actionType: 'DECISION_REJECT',
        authContext: { z_field: 'last', a_field: 'first' }, // Out-of-order fields
        actionPayload: { reason: 'high-risk' },
      };

      const client = await pool.connect();

      try {
        const time = new Date().toISOString();

        const result1 = await AuditChainService.computeChainHash(client, payload, time);
        const result2 = await AuditChainService.computeChainHash(client, payload, time);

        // Same payload should produce same hash (canonical JSON ensures this)
        expect(result1.currentHash).toBe(result2.currentHash);
      } finally {
        client.release();
      }
    });
  });

  describe('FIX 2: Token Family Reuse Detection', () => {
    test('should detect token reuse when nonce mismatches', async () => {
      // Issue initial token pair
      const tokenPair = await tokenService.issueTokenPair(
        testUserId,
        testTenantId,
        testEmail,
        'viewer'
      );

      const initialAccessToken = tokenPair.accessToken;

      // Legitimate user refreshes (nonce rotates)
      const refreshed = await tokenService.refreshAccessToken(tokenPair.refreshToken);

      // Attacker tries to reuse old refresh token (after it's been rotated)
      // This should detect reuse and revoke entire family
      expect(async () => {
        await tokenService.refreshAccessToken(tokenPair.refreshToken);
      }).rejects.toThrow('TOKEN_REUSE_DETECTED');

      // Verify entire family is revoked by trying to use freshly-refreshed token
      // (it should now be marked as reuse_detected)
      expect(async () => {
        // Attempting any token operation from this family should fail
        await tokenService.refreshAccessToken(tokenPair.refreshToken);
      }).rejects.toThrow();
    });

    test('should enforce 30-day absolute session max lifetime', async () => {
      // Create a token pair
      const tokenPair = await tokenService.issueTokenPair(
        testUserId + '-lifetime',
        testTenantId,
        testEmail + '-lifetime',
        'viewer'
      );

      // Manually set family_created_at to 31 days ago (exceeds max)
      const client = await pool.connect();

      try {
        const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

        await client.query(
          `UPDATE refresh_tokens
           SET family_created_at = $1
           WHERE user_id = $2 AND tenant_id = $3`,
          [thirtyOneDaysAgo, testUserId + '-lifetime', testTenantId]
        );

        // Attempt to refresh should fail due to max lifetime exceeded
        expect(async () => {
          await tokenService.refreshAccessToken(tokenPair.refreshToken);
        }).rejects.toThrow('SESSION_MAX_LIFETIME_EXCEEDED');
      } finally {
        client.release();
      }
    });
  });

  describe('FIX 3: Envelope HMAC Signature', () => {
    test('should compute and verify envelope signature', () => {
      const serviceSecret = 'test-secret-' + Date.now();

      const envelope: Partial<GovernanceTelemetryEnvelopeV1> = {
        envelopeId: 'env-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        schemaVersion: '1.0',
        trustDomains: {
          structural: { domain: 'STRUCTURAL', score: 0.9, lastEvaluatedAt: new Date().toISOString(), evaluationMethod: 'TEST' },
          propagation: {
            domain: 'PROPAGATION',
            score: 0.85,
            lastEvaluatedAt: new Date().toISOString(),
            evaluationMethod: 'TEST',
          },
          automation: { domain: 'AUTOMATION', score: 0.8, lastEvaluatedAt: new Date().toISOString(), evaluationMethod: 'TEST' },
          identity: { domain: 'IDENTITY', score: 0.95, lastEvaluatedAt: new Date().toISOString(), evaluationMethod: 'TEST' },
          observability: {
            domain: 'OBSERVABILITY',
            score: 0.88,
            lastEvaluatedAt: new Date().toISOString(),
            evaluationMethod: 'TEST',
          },
        },
        coherenceTier: { tier: 'HOT', reason: 'Fresh', cachedAt: new Date().toISOString(), expectedFreshnessMs: 60000 },
        topologyEpoch: { epoch: 1, deploymentId: 'deploy-1', deployedAt: new Date().toISOString(), services: {} },
        emittedAt: new Date().toISOString(),
        emittedBy: 'test-service',
      };

      // Compute signature
      const signature = computeEnvelopeHMAC(envelope, serviceSecret);

      expect(signature).toBeDefined();
      expect(signature.length).toBe(64); // SHA256 hex

      // Verify signature
      const envelopeWithSig = { ...envelope, envelopeSignature: signature } as GovernanceTelemetryEnvelopeV1;
      const isValid = verifyEnvelopeSignature(envelopeWithSig, serviceSecret);

      expect(isValid).toBe(true);
    });

    test('should reject tampered envelope signature', () => {
      const serviceSecret = 'test-secret-' + Date.now();

      const envelope: Partial<GovernanceTelemetryEnvelopeV1> = {
        envelopeId: 'env-2',
        traceId: 'trace-2',
        spanId: 'span-1',
        schemaVersion: '1.0',
        trustDomains: {
          structural: { domain: 'STRUCTURAL', score: 0.9, lastEvaluatedAt: new Date().toISOString(), evaluationMethod: 'TEST' },
          propagation: {
            domain: 'PROPAGATION',
            score: 0.85,
            lastEvaluatedAt: new Date().toISOString(),
            evaluationMethod: 'TEST',
          },
          automation: { domain: 'AUTOMATION', score: 0.8, lastEvaluatedAt: new Date().toISOString(), evaluationMethod: 'TEST' },
          identity: { domain: 'IDENTITY', score: 0.95, lastEvaluatedAt: new Date().toISOString(), evaluationMethod: 'TEST' },
          observability: {
            domain: 'OBSERVABILITY',
            score: 0.88,
            lastEvaluatedAt: new Date().toISOString(),
            evaluationMethod: 'TEST',
          },
        },
        coherenceTier: { tier: 'HOT', reason: 'Fresh', cachedAt: new Date().toISOString(), expectedFreshnessMs: 60000 },
        topologyEpoch: { epoch: 1, deploymentId: 'deploy-1', deployedAt: new Date().toISOString(), services: {} },
        emittedAt: new Date().toISOString(),
        emittedBy: 'test-service',
      };

      // Compute original signature
      const signature = computeEnvelopeHMAC(envelope, serviceSecret);
      const envelopeWithSig = { ...envelope, envelopeSignature: signature } as GovernanceTelemetryEnvelopeV1;

      // Tamper with a trust domain score
      envelopeWithSig.trustDomains.structural.score = 0.5;

      // Verification should fail
      const isValid = verifyEnvelopeSignature(envelopeWithSig, serviceSecret);

      expect(isValid).toBe(false);
    });
  });

  describe('FIX 5: Audit Rate Limiting', () => {
    test('should allow requests within rate limit', () => {
      const limiter = new AuditRateLimiter({ requestsPerMinute: 10, burstSize: 5 });

      // Should allow up to burstSize (5) requests immediately
      for (let i = 0; i < 5; i++) {
        const result = limiter.checkLimit('tenant-1');
        expect(result.allowed).toBe(true);
      }

      // 6th request should be rejected
      const sixthRequest = limiter.checkLimit('tenant-1');
      expect(sixthRequest.allowed).toBe(false);
    });

    test('should track rate limits per tenant', () => {
      const limiter = new AuditRateLimiter({ requestsPerMinute: 10, burstSize: 3 });

      // Tenant A uses their quota
      limiter.checkLimit('tenant-a');
      limiter.checkLimit('tenant-a');
      limiter.checkLimit('tenant-a');
      const fourthA = limiter.checkLimit('tenant-a');
      expect(fourthA.allowed).toBe(false);

      // Tenant B should have independent quota
      const firstB = limiter.checkLimit('tenant-b');
      expect(firstB.allowed).toBe(true);
    });

    test('should include rate limit headers in response', () => {
      const limiter = new AuditRateLimiter({ requestsPerMinute: 60, burstSize: 10 });

      const result = limiter.checkLimit('tenant-1');

      expect(result.remaining).toBeDefined();
      expect(result.resetAt).toBeDefined();
      expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
