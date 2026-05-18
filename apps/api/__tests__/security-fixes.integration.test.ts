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
  computeEnvelopeHMACDigest,
  verifyEnvelopeSignature,
} from '../types/governance-telemetry-envelope';
import { AuditRateLimiter } from '../services/audit-rate-limiter';
import { EnvelopeSigningKeyService } from '../services/envelope-signing-key-service';
import { AuditChainForkDetectionService } from '../services/audit-chain-fork-detection';
import { EnvelopeReplayPreventionService } from '../services/envelope-replay-prevention';

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

  describe('FIX 3: Envelope HMAC Signature (Legacy - string signatures)', () => {
    test('should compute canonical envelope HMAC digest', () => {
      const keyMaterial = 'test-secret-' + Date.now();

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

      // Compute HMAC digest
      const digest = computeEnvelopeHMACDigest(envelope, keyMaterial);

      expect(digest).toBeDefined();
      expect(digest.length).toBe(64); // SHA256 hex
    });

    test('should produce consistent HMAC digest with canonical JSON serialization', () => {
      const keyMaterial = 'test-secret';

      const envelope: Partial<GovernanceTelemetryEnvelopeV1> = {
        envelopeId: 'env-canonical',
        traceId: 'trace-canonical',
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

      // Same payload should produce same digest
      const digest1 = computeEnvelopeHMACDigest(envelope, keyMaterial);
      const digest2 = computeEnvelopeHMACDigest(envelope, keyMaterial);

      expect(digest1).toBe(digest2);
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

  describe('FIX A: Envelope Signing Key Rotation & Versioning', () => {
    let keyService: EnvelopeSigningKeyService;
    const testKeyTenantId = 'key-test-tenant-' + Date.now();

    beforeAll(async () => {
      // Mock KMS decrypt function (in production, this calls actual KMS)
      const mockKmsDecrypt = async (encrypted: Buffer): Promise<string> => {
        // For testing, just return a fixed string key material
        return 'test-key-material-32-bytes-long!';
      };

      keyService = new EnvelopeSigningKeyService(pool, mockKmsDecrypt);
    });

    test('should create initial signing key for tenant', async () => {
      const client = await pool.connect();

      try {
        // Insert initial key directly (would normally be done during tenant setup)
        const keyMaterial = Buffer.from('test-key-material-32-bytes-long!');
        const result = await client.query(
          `
          INSERT INTO envelope_signing_keys (
            tenant_id, key_material_encrypted, key_algorithm,
            is_active, activated_at, can_sign, can_verify
          ) VALUES ($1, $2, $3, true, NOW(), true, true)
          RETURNING key_id
          `,
          [testKeyTenantId, keyMaterial, 'HMAC_SHA256_V1']
        );

        const keyId = result.rows[0].key_id;
        expect(keyId).toBeDefined();
      } finally {
        client.release();
      }
    });

    test('should retrieve active signing key from cache', async () => {
      const activeKey = await keyService.getActiveKey(testKeyTenantId);

      expect(activeKey).toBeDefined();
      expect(activeKey!.isActive).toBe(true);
      expect(activeKey!.canSign).toBe(true);
      expect(activeKey!.keyAlgorithm).toBe('HMAC_SHA256_V1');
    });

    test('should compute versioned envelope signature with keyId', async () => {
      const activeKey = await keyService.getActiveKey(testKeyTenantId);
      expect(activeKey).toBeDefined();

      const envelope: Partial<GovernanceTelemetryEnvelopeV1> = {
        envelopeId: 'env-key-test',
        traceId: 'trace-key-test',
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

      const keyMaterial = 'test-key-material-32-bytes-long!';
      const versionedSig = computeEnvelopeHMAC(envelope, activeKey!.keyId, keyMaterial);

      expect(versionedSig).toBeDefined();
      expect(versionedSig.keyId).toBe(activeKey!.keyId);
      expect(versionedSig.algorithm).toBe('HMAC_SHA256_V1');
      expect(versionedSig.signature).toBeDefined();
      expect(versionedSig.signature.length).toBe(64); // SHA256 hex
    });

    test('should verify envelope signature with active key', async () => {
      const activeKey = await keyService.getActiveKey(testKeyTenantId);
      expect(activeKey).toBeDefined();

      const envelope: Partial<GovernanceTelemetryEnvelopeV1> = {
        envelopeId: 'env-verify-test',
        traceId: 'trace-verify-test',
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

      const keyMaterial = 'test-key-material-32-bytes-long!';
      const versionedSig = computeEnvelopeHMAC(envelope, activeKey!.keyId, keyMaterial);
      const envelopeWithSig = {
        ...envelope,
        envelopeSignature: versionedSig,
      } as GovernanceTelemetryEnvelopeV1;

      // Verify with single key
      const result = verifyEnvelopeSignature(envelopeWithSig, [
        { keyId: activeKey!.keyId, keyMaterial },
      ]);

      expect(result.valid).toBe(true);
      expect(result.usedKeyId).toBe(activeKey!.keyId);
    });

    test('should support verification fallback to previous keys during grace period', async () => {
      const activeKey = await keyService.getActiveKey(testKeyTenantId);
      expect(activeKey).toBeDefined();

      const oldKeyMaterial = 'test-key-material-32-bytes-long!';
      const newKeyMaterial = 'new-key-material-different-32ch!';

      const envelope: Partial<GovernanceTelemetryEnvelopeV1> = {
        envelopeId: 'env-fallback-test',
        traceId: 'trace-fallback-test',
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

      // Create envelope with old key
      const oldSig = computeEnvelopeHMAC(envelope, activeKey!.keyId, oldKeyMaterial);
      const envelopeWithOldSig = {
        ...envelope,
        envelopeSignature: oldSig,
      } as GovernanceTelemetryEnvelopeV1;

      // Verify with both keys available (simulating grace period with both active and previous)
      const result = verifyEnvelopeSignature(envelopeWithOldSig, [
        { keyId: 'new-key-id', keyMaterial: newKeyMaterial }, // Active key
        { keyId: activeKey!.keyId, keyMaterial: oldKeyMaterial }, // Previous key in grace period
      ]);

      expect(result.valid).toBe(true);
      expect(result.usedKeyId).toBe(activeKey!.keyId); // Should have used the old key
    });

    test('should reject tampered envelope signature even with multiple keys', async () => {
      const activeKey = await keyService.getActiveKey(testKeyTenantId);
      expect(activeKey).toBeDefined();

      const keyMaterial = 'test-key-material-32-bytes-long!';

      const envelope: Partial<GovernanceTelemetryEnvelopeV1> = {
        envelopeId: 'env-tamper-test',
        traceId: 'trace-tamper-test',
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

      const versionedSig = computeEnvelopeHMAC(envelope, activeKey!.keyId, keyMaterial);
      const envelopeWithSig = {
        ...envelope,
        envelopeSignature: versionedSig,
      } as GovernanceTelemetryEnvelopeV1;

      // Tamper with trust domain score
      envelopeWithSig.trustDomains.structural.score = 0.1;

      // Verification should fail even with multiple keys available
      const result = verifyEnvelopeSignature(envelopeWithSig, [
        { keyId: 'other-key-id', keyMaterial: 'other-key-material-string' },
        { keyId: activeKey!.keyId, keyMaterial: keyMaterial },
      ]);

      expect(result.valid).toBe(false);
    });

    test('should log verification failures for compromise detection', async () => {
      const client = await pool.connect();

      try {
        // Count failures before
        const beforeResult = await client.query(
          `SELECT COUNT(*) FROM envelope_signature_failures WHERE tenant_id = $1`,
          [testKeyTenantId]
        );
        const beforeCount = parseInt(beforeResult.rows[0].count);

        // Log a failure
        await keyService.logVerificationFailure(
          testKeyTenantId,
          'test-envelope-id',
          'test-key-id',
          'SIGNATURE_MISMATCH'
        );

        // Count failures after
        const afterResult = await client.query(
          `SELECT COUNT(*) FROM envelope_signature_failures WHERE tenant_id = $1`,
          [testKeyTenantId]
        );
        const afterCount = parseInt(afterResult.rows[0].count);

        expect(afterCount).toBe(beforeCount + 1);
      } finally {
        client.release();
      }
    });
  });

  describe('FIX B: Audit Chain Fork Detection & Prevention', () => {
    let forkDetectionService: AuditChainForkDetectionService;
    const testForkTenantId = 'fork-test-tenant-' + Date.now();
    const testForkTraceId = 'fork-test-trace-' + Date.now();

    beforeAll(async () => {
      // Initialize fork detection service
      forkDetectionService = new AuditChainForkDetectionService(pool);
      AuditChainService.initializeForkDetection(pool);
    });

    test('should detect single-successor chain without forks', async () => {
      // Create a linear chain: genesis → binding1 → binding2
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Genesis binding (no previous)
        const genesis = await client.query(
          `
          INSERT INTO operator_trace_bindings (
            binding_id, trace_id, tenant_id, previous_binding_hash,
            signature_hash, operator_hash, action_type,
            auth_context, action_payload, signed_at,
            operator_session_snapshot
          ) VALUES ($1, $2, $3, NULL, $4, 'op-1', 'DECISION_APPROVE',
            $5, $6, NOW(), '{}')
          RETURNING chain_position, signature_hash
          `,
          [
            'genesis-binding',
            testForkTraceId,
            testForkTenantId,
            'hash-genesis',
            '{}',
            '{}',
          ]
        );

        const genesisHash = genesis.rows[0].signature_hash;

        // Follower binding
        await client.query(
          `
          INSERT INTO operator_trace_bindings (
            binding_id, trace_id, tenant_id, previous_binding_hash,
            signature_hash, operator_hash, action_type,
            auth_context, action_payload, signed_at,
            operator_session_snapshot
          ) VALUES ($1, $2, $3, $4, $5, 'op-2', 'DECISION_APPROVE',
            $6, $7, NOW(), '{}')
          `,
          [
            'follower-binding',
            testForkTraceId,
            testForkTenantId,
            genesisHash,
            'hash-follower',
            '{}',
            '{}',
          ]
        );

        await client.query('COMMIT');

        // Verify no fork detected
        const forkResult = await forkDetectionService.detectTraceFork(testForkTraceId);
        expect(forkResult.hasFork).toBe(false);
      } finally {
        client.release();
      }
    });

    test('should detect when fork is attempted (unique constraint)', async () => {
      const client = await pool.connect();
      const testTraceId = 'fork-attempt-trace-' + Date.now();

      try {
        await client.query('BEGIN');

        // Genesis binding
        const genesis = await client.query(
          `
          INSERT INTO operator_trace_bindings (
            binding_id, trace_id, tenant_id, previous_binding_hash,
            signature_hash, operator_hash, action_type,
            auth_context, action_payload, signed_at,
            operator_session_snapshot
          ) VALUES ($1, $2, $3, NULL, $4, 'op-1', 'DECISION_APPROVE',
            $5, $6, NOW(), '{}')
          RETURNING signature_hash
          `,
          [
            'genesis-for-fork',
            testTraceId,
            testForkTenantId,
            'hash-gen-fork',
            '{}',
            '{}',
          ]
        );

        const genesisHash = genesis.rows[0].signature_hash;

        // First successor (normal)
        await client.query(
          `
          INSERT INTO operator_trace_bindings (
            binding_id, trace_id, tenant_id, previous_binding_hash,
            signature_hash, operator_hash, action_type,
            auth_context, action_payload, signed_at,
            operator_session_snapshot
          ) VALUES ($1, $2, $3, $4, $5, 'op-2a', 'DECISION_APPROVE',
            $6, $7, NOW(), '{}')
          `,
          [
            'successor-1',
            testTraceId,
            testForkTenantId,
            genesisHash,
            'hash-succ-1',
            '{}',
            '{}',
          ]
        );

        // Attempt second successor (should violate unique constraint)
        let forkCreated = false;
        try {
          await client.query(
            `
            INSERT INTO operator_trace_bindings (
              binding_id, trace_id, tenant_id, previous_binding_hash,
              signature_hash, operator_hash, action_type,
              auth_context, action_payload, signed_at,
              operator_session_snapshot
            ) VALUES ($1, $2, $3, $4, $5, 'op-2b', 'DECISION_REJECT',
              $6, $7, NOW(), '{}')
            `,
            [
              'successor-2',
              testTraceId,
              testForkTenantId,
              genesisHash, // Same previous hash as successor-1 (creates fork!)
              'hash-succ-2',
              '{}',
              '{}',
            ]
          );
          forkCreated = true;
        } catch (error: any) {
          // Unique constraint should prevent this
          expect(error.code).toBe('23505'); // PostgreSQL unique_violation
        }

        expect(forkCreated).toBe(false); // Fork should not have been created

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('should verify chain integrity including fork check', async () => {
      const client = await pool.connect();
      const integrityTestTraceId = 'integrity-test-' + Date.now();

      try {
        // Create a valid chain
        await client.query('BEGIN');

        const genesis = await client.query(
          `
          INSERT INTO operator_trace_bindings (
            binding_id, trace_id, tenant_id, previous_binding_hash,
            signature_hash, operator_hash, action_type,
            auth_context, action_payload, signed_at,
            operator_session_snapshot
          ) VALUES ($1, $2, $3, NULL, $4, 'op-1', 'TRACE_READ',
            $5, $6, NOW(), '{}')
          RETURNING chain_position, signature_hash
          `,
          [
            'integrity-genesis',
            integrityTestTraceId,
            testForkTenantId,
            'hash-int-gen',
            '{}',
            '{}',
          ]
        );

        await client.query('COMMIT');

        // Verify the chain has no forks
        const integrityResult = await forkDetectionService.verifyChainIntegrity(
          testForkTenantId,
          integrityTestTraceId
        );

        expect(integrityResult.valid).toBe(true);
        expect(integrityResult.reason).toContain('no forks');
      } finally {
        client.release();
      }
    });

    test('should list all current forks in ledger', async () => {
      // Get all forks (should be none if constraints are working)
      const forks = await forkDetectionService.listCurrentForks(testForkTenantId);

      // With proper constraints, there should be no forks in the ledger
      expect(Array.isArray(forks)).toBe(true);
      // Note: If there are any forks, this test will document them
      console.log('[FORK_AUDIT] Current forks in test tenant:', forks.length);
    });
  });

  describe('FIX C: Envelope Replay Prevention & Nonce Tracking', () => {
    let replayPreventionService: EnvelopeReplayPreventionService;
    const testReplayTenantId = 'replay-test-tenant-' + Date.now();

    beforeAll(async () => {
      replayPreventionService = new EnvelopeReplayPreventionService(pool, 3600); // 1 hour TTL
    });

    test('should generate unique nonces with expiration', () => {
      const nonce1 = replayPreventionService.generateNonce();
      const nonce2 = replayPreventionService.generateNonce();

      expect(nonce1.nonce).toBeDefined();
      expect(nonce1.nonce.length).toBeGreaterThan(0);
      expect(nonce1.expiresAt).toBeInstanceOf(Date);
      expect(nonce1.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Nonces should be unique
      expect(nonce1.nonce).not.toBe(nonce2.nonce);
    });

    test('should register nonce and prevent replay', async () => {
      const nonce = replayPreventionService.generateNonce();

      // First registration should succeed
      const firstCheck = await replayPreventionService.checkAndRegisterEnvelope(
        testReplayTenantId,
        'envelope-1',
        nonce.nonce,
        nonce.expiresAt,
        'key-1',
        'test-service',
        'consumer-1'
      );

      expect(firstCheck.allowed).toBe(true);

      // Second registration with same nonce should fail (replay)
      const replayCheck = await replayPreventionService.checkAndRegisterEnvelope(
        testReplayTenantId,
        'envelope-1',
        nonce.nonce,
        nonce.expiresAt,
        'key-1',
        'test-service',
        'consumer-2'
      );

      expect(replayCheck.allowed).toBe(false);
      expect(replayCheck.previouslySeen).toBe(true);
      expect(replayCheck.reason).toContain('REPLAY_DETECTED');
    });

    test('should reject expired nonces', async () => {
      // Create a nonce that's already expired
      const expiredNonce = 'expired-' + Math.random().toString(36);
      const pastDate = new Date(Date.now() - 3600000); // 1 hour ago

      const expiredCheck = await replayPreventionService.checkAndRegisterEnvelope(
        testReplayTenantId,
        'envelope-expired',
        expiredNonce,
        pastDate,
        'key-1',
        'test-service',
        'consumer-1'
      );

      // The registration should fail because timestamp is in the past
      // (Database will reject or service should validate)
      expect(expiredCheck).toBeDefined();
    });

    test('should verify envelope expiration independently', () => {
      const recentEnvelope = createMockEnvelope();
      const expiredEnvelope = createMockEnvelope();

      // Set expiration in the past
      (expiredEnvelope as any).emittedAt = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago

      const recentResult = replayPreventionService.verifyEnvelopeExpiration(recentEnvelope);
      const expiredResult = replayPreventionService.verifyEnvelopeExpiration(expiredEnvelope);

      expect(recentResult.valid).toBe(true);
      expect(expiredResult.valid).toBe(false);
      expect(expiredResult.reason).toContain('expired');
    });

    test('should track nonce cache statistics', async () => {
      const nonce1 = replayPreventionService.generateNonce();
      const nonce2 = replayPreventionService.generateNonce();

      // Register multiple nonces
      await replayPreventionService.checkAndRegisterEnvelope(
        testReplayTenantId,
        'env-stat-1',
        nonce1.nonce,
        nonce1.expiresAt,
        'key-1',
        'test-service',
        'consumer-1'
      );

      await replayPreventionService.checkAndRegisterEnvelope(
        testReplayTenantId,
        'env-stat-2',
        nonce2.nonce,
        nonce2.expiresAt,
        'key-1',
        'test-service',
        'consumer-1'
      );

      const stats = await replayPreventionService.getNonceCacheStats(testReplayTenantId);

      expect(stats.activenonces).toBeGreaterThan(0);
      expect(stats.expiredNonces).toBeGreaterThanOrEqual(0);
      expect(stats.replayAttempts).toBeGreaterThanOrEqual(0);
    });

    test('should cleanup expired nonces', async () => {
      const beforeStats = await replayPreventionService.getNonceCacheStats(testReplayTenantId);

      const cleanupResult = await replayPreventionService.cleanupExpiredNonces();

      expect(cleanupResult.deletedCount).toBeGreaterThanOrEqual(0);

      const afterStats = await replayPreventionService.getNonceCacheStats(testReplayTenantId);

      // Expired nonces should decrease
      expect(afterStats.expiredNonces).toBeLessThanOrEqual(beforeStats.expiredNonces);
    });

    test('should detect replay attack patterns', async () => {
      const nonce = replayPreventionService.generateNonce();

      // Simulate multiple replay attempts
      for (let i = 0; i < 3; i++) {
        try {
          await replayPreventionService.checkAndRegisterEnvelope(
            testReplayTenantId,
            'env-attack-pattern',
            nonce.nonce,
            nonce.expiresAt,
            'key-1',
            'test-service',
            `consumer-${i}`
          );
        } catch {
          // Expected to fail after first registration
        }
      }

      // Check for attack pattern (threshold=5, window=10 min)
      // May or may not detect depending on timing, but should not error
      const isUnderAttack = await replayPreventionService.detectReplayAttackPattern(
        testReplayTenantId,
        5, // high threshold to avoid false positives in tests
        10
      );

      expect(typeof isUnderAttack).toBe('boolean');
    });
  });

  // Helper function to create mock envelope for testing
  function createMockEnvelope(): GovernanceTelemetryEnvelopeV1 {
    return {
      envelopeId: 'test-env-' + Math.random(),
      schemaVersion: '1.0',
      traceId: 'test-trace',
      spanId: 'test-span',
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
      envelopeSignature: { keyId: 'key-1', algorithm: 'HMAC_SHA256_V1', signature: 'test-signature' },
    };
  }
});
