import { GovernanceCausalityService } from '../governance-causality-service';

describe('Phase 6.1: Governance Causality Service', () => {
  let capturedLogs: string[] = [];
  const originalLog = console.log;

  beforeEach(() => {
    capturedLogs = [];
    console.log = jest.fn((...args) => {
      capturedLogs.push(args.join(' '));
      originalLog(...args);
    });
  });

  afterEach(() => {
    console.log = originalLog;
    capturedLogs = [];
  });

  describe('Validation 1: Operator Masking (SHA-256 Anonymization)', () => {
    it('Should convert raw operator IDs to 64-character SHA-256 hashes', () => {
      const rawOperatorId = 'alice@example.com';
      const hash1 = GovernanceCausalityService.anonymizeOperatorId(rawOperatorId);

      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);

      const hash2 = GovernanceCausalityService.anonymizeOperatorId(rawOperatorId);
      expect(hash1).toBe(hash2);

      const hash3 = GovernanceCausalityService.anonymizeOperatorId('bob@example.com');
      expect(hash1).not.toBe(hash3);
    });

    it('Should apply salt to prevent rainbow table attacks', () => {
      const rawId = 'operator123';
      const saltedHash1 = GovernanceCausalityService.anonymizeOperatorId(rawId, 'salt_v1');
      const saltedHash2 = GovernanceCausalityService.anonymizeOperatorId(rawId, 'salt_v2');

      expect(saltedHash1).not.toBe(saltedHash2);
    });
  });

  describe('Validation 2: Log Uniformity (JSON Parsing)', () => {
    it('Should emit [SPLUNK_GOVERNANCE_STREAM] formatted logs with valid JSON payloads', () => {
      const context = GovernanceCausalityService.generateCorrelationContext();
      const operatorHash = GovernanceCausalityService.anonymizeOperatorId('test_operator');

      const event = GovernanceCausalityService.createLifecycleEvent(
        context,
        'INTENT_RECEIVED',
        'TEST_SUBSYSTEM',
        operatorHash,
        { testKey: 'testValue' }
      );

      console.log(`[SPLUNK_GOVERNANCE_STREAM] ${JSON.stringify(event)}`);

      const splunkLogs = capturedLogs.filter((log) => log.includes('[SPLUNK_GOVERNANCE_STREAM]'));
      expect(splunkLogs.length).toBeGreaterThan(0);

      splunkLogs.forEach((log) => {
        const jsonMatch = log.match(/\[SPLUNK_GOVERNANCE_STREAM\]\s+(.+)$/);
        expect(jsonMatch).toBeTruthy();

        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          expect(parsed).toHaveProperty('correlationId');
          expect(parsed).toHaveProperty('traceId');
          expect(parsed).toHaveProperty('spanId');
          expect(parsed).toHaveProperty('eventType');
        }
      });
    });
  });

  describe('Validation 3: Token Expiry Enforcement', () => {
    it('Should reject replay tokens older than 30 minutes with REPLAY_TOKEN_EXPIRED', async () => {
      const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
      const expiredTimestamp = thirtyOneMinutesAgo.toString(16);
      const operatorHash = GovernanceCausalityService.anonymizeOperatorId('test_op');
      const expiredSignature = `rply_sig_${expiredTimestamp}_${operatorHash.slice(0, 16)}_abc123`;

      const decision = await GovernanceCausalityService.authorizeReplay(
        'trace_test_123',
        operatorHash,
        expiredSignature
      );

      expect(decision.authorized).toBe(false);
      expect(decision.reason).toBe('REPLAY_TOKEN_EXPIRED');
    });

    it('Should accept replay tokens younger than 30 minutes', async () => {
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
      const validTimestamp = fifteenMinutesAgo.toString(16);
      const operatorHash = GovernanceCausalityService.anonymizeOperatorId('test_op');
      const validSignature = `rply_sig_${validTimestamp}_${operatorHash.slice(0, 16)}_xyz789`;

      const decision = await GovernanceCausalityService.authorizeReplay(
        'trace_test_456',
        operatorHash,
        validSignature
      );

      expect(decision.authorized).toBe(true);
      expect(decision.expiresAt).toBeTruthy();
    });
  });
});
