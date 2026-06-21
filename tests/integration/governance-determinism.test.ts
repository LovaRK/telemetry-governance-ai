/**
 * INVARIANT 1: Deterministic Governance
 * Tests that the same governance inputs always produce identical decisions.
 *
 * This is the core constitutional invariant.
 * If governance is non-deterministic, the entire system is untrustworthy.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { RuntimeGovernanceEngine, Decision, RiskLevel } from '../../core/governance/engine';

describe('INVARIANT 1: Deterministic Governance', () => {
  let sandboxEngine: RuntimeGovernanceEngine;
  let productionEngine: RuntimeGovernanceEngine;

  beforeEach(() => {
    sandboxEngine = new RuntimeGovernanceEngine('sandbox');
    productionEngine = new RuntimeGovernanceEngine('production');
  });

  describe('Determinism: Same inputs → same outputs', () => {
    it('should return identical decisions for identical requests (10 iterations)', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-123',
        actor_type: 'agent' as const,
        resource: 'splunk:config:45.76.167.6:8089',
        trace_id: 'trace-abc-12345',
        correlation_id: 'corr-xyz-67890',
        policy_snapshot_hash: 'policy-hash-sha256-1234567890abcdef'
      };

      const decisions = [];
      for (let i = 0; i < 10; i++) {
        decisions.push(sandboxEngine.evaluate(request));
      }

      // All decisions should be identical
      decisions.forEach((decision, idx) => {
        expect(decision.decision).toBe(Decision.DENY);
        expect(decision.risk_level).toBe(RiskLevel.CRITICAL);
        expect(decision.matched_policy_ids).toEqual(['policy-environment-isolation-1']);
        expect(decision.environment).toBe('sandbox');
        expect(decision.actor_id).toBe('agent-123');
      });

      // All decision IDs should be identical (deterministic generation)
      const firstDecisionId = decisions[0].decision_id;
      decisions.forEach((decision, idx) => {
        expect(decision.decision_id).toBe(firstDecisionId);
      });
    });

    it('should reject production IP (45.76.167.6) in sandbox', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-123',
        actor_type: 'agent' as const,
        resource: 'splunk:config:45.76.167.6:8089',
        trace_id: 'trace-abc',
        correlation_id: 'corr-xyz',
        policy_snapshot_hash: 'policy-hash-123'
      };

      const decision = sandboxEngine.evaluate(request);

      expect(decision.decision).toBe(Decision.DENY);
      expect(decision.risk_level).toBe(RiskLevel.CRITICAL);
      expect(decision.enforcement_mode).toBe('hard-block');
      expect(decision.reasons).toContain('Production IP (45.76.167.6) is blocked in sandbox environment');
      expect(decision.environment).toBe('sandbox');
    });

    it('should allow sandbox IP (144.202.48.85) in sandbox', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-123',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-abc',
        correlation_id: 'corr-xyz',
        policy_snapshot_hash: 'policy-hash-123'
      };

      const decision = sandboxEngine.evaluate(request);

      expect(decision.decision).toBe(Decision.ALLOW);
      expect(decision.risk_level).toBe(RiskLevel.LOW);
      expect(decision.enforcement_mode).toBe('hard-block'); // Default for ALLOW
      expect(decision.matched_policy_ids).toEqual([]);
      expect(decision.reasons).toContain('No policies matched; resource approved for action');
    });

    it('should produce identical decision IDs for identical requests (3x)', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-123',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-abc',
        correlation_id: 'corr-xyz',
        policy_snapshot_hash: 'policy-hash-123'
      };

      const decision1 = sandboxEngine.evaluate(request);
      const decision2 = sandboxEngine.evaluate(request);
      const decision3 = sandboxEngine.evaluate(request);

      // Decision IDs must be identical (deterministic)
      expect(decision1.decision_id).toBe(decision2.decision_id);
      expect(decision2.decision_id).toBe(decision3.decision_id);

      // Timestamps may differ, but decision is same
      expect(decision1.decision).toBe(decision2.decision);
      expect(decision2.decision).toBe(decision3.decision);
    });

    it('should block "prod" pattern in resource name', () => {
      const prodResources = [
        'splunk:config:prod-splunk.internal:8089',
        'splunk:config:splunk-prod.example.com:8089',
        'splunk:config:my-prod-instance:8089',
        'resource:production:data:endpoint'
      ];

      prodResources.forEach(resource => {
        const request = {
          action: 'SAVE_SPLUNK_CONFIG',
          actor_id: 'agent-123',
          actor_type: 'agent' as const,
          resource,
          trace_id: 'trace-abc',
          correlation_id: 'corr-xyz',
          policy_snapshot_hash: 'policy-hash-123'
        };

        const decision = sandboxEngine.evaluate(request);

        expect(decision.decision).toBe(Decision.DENY);
        expect(decision.risk_level).toBe(RiskLevel.CRITICAL);
        expect(decision.reasons.some(r => r.includes('Production resource pattern'))).toBe(true);
      });
    });

    it('should allow sandbox resources in sandbox', () => {
      const sandboxResources = [
        'splunk:config:144.202.48.85:8089',
        'splunk:config:localhost:8089',
        'splunk:config:127.0.0.1:8089',
        'splunk:config:host.docker.internal:8089'
      ];

      sandboxResources.forEach(resource => {
        const request = {
          action: 'SAVE_SPLUNK_CONFIG',
          actor_id: 'agent-123',
          actor_type: 'agent' as const,
          resource,
          trace_id: 'trace-abc',
          correlation_id: 'corr-xyz',
          policy_snapshot_hash: 'policy-hash-123'
        };

        const decision = sandboxEngine.evaluate(request);

        expect(decision.decision).toBe(Decision.ALLOW);
        expect(decision.risk_level).toBe(RiskLevel.LOW);
      });
    });

    it('should allow any resource in production environment', () => {
      const resources = [
        'splunk:config:45.76.167.6:8089', // Production IP
        'splunk:config:prod-splunk.com:8089', // Production hostname
        'splunk:config:production.internal:8089', // Production pattern
        'splunk:config:any-random-host:8089' // Any hostname
      ];

      resources.forEach(resource => {
        const request = {
          action: 'SAVE_SPLUNK_CONFIG',
          actor_id: 'agent-123',
          actor_type: 'agent' as const,
          resource,
          trace_id: 'trace-abc',
          correlation_id: 'corr-xyz',
          policy_snapshot_hash: 'policy-hash-123'
        };

        const decision = productionEngine.evaluate(request);

        expect(decision.decision).toBe(Decision.ALLOW);
        expect(decision.environment).toBe('production');
      });
    });

    it('should include schema versions in decision', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-123',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-abc',
        correlation_id: 'corr-xyz',
        policy_snapshot_hash: 'policy-hash-123'
      };

      const decision = sandboxEngine.evaluate(request);

      expect(decision.decision_schema_version).toBe('1.0.0');
      expect(decision.policy_schema_version).toBe('1.0.0');
    });

    it('should preserve trace and correlation IDs', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-123',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-very-unique-id-12345',
        correlation_id: 'corr-very-unique-id-67890',
        causation_id: 'cause-parent-action-id',
        policy_snapshot_hash: 'policy-hash-123'
      };

      const decision = sandboxEngine.evaluate(request);

      expect(decision.trace_id).toBe('trace-very-unique-id-12345');
      expect(decision.correlation_id).toBe('corr-very-unique-id-67890');
      expect(decision.causation_id).toBe('cause-parent-action-id');
    });
  });

  describe('Environmental consistency', () => {
    it('should initialize with correct environment (sandbox)', () => {
      const engine = new RuntimeGovernanceEngine('sandbox');
      expect(engine.getEnvironment()).toBe('sandbox');
    });

    it('should initialize with correct environment (production)', () => {
      const engine = new RuntimeGovernanceEngine('production');
      expect(engine.getEnvironment()).toBe('production');
    });

    it('should throw on invalid environment', () => {
      expect(() => {
        new RuntimeGovernanceEngine('invalid-env');
      }).toThrow('[GOVERNANCE_STARTUP_FAILED]');
    });

    it('should default to sandbox if APP_ENV not set', () => {
      const prevEnv = process.env.APP_ENV;
      delete process.env.APP_ENV;

      try {
        const engine = new RuntimeGovernanceEngine();
        expect(engine.getEnvironment()).toBe('sandbox');
      } finally {
        if (prevEnv) process.env.APP_ENV = prevEnv;
      }
    });
  });

  describe('Determinism stability', () => {
    it('should return same decision_id across multiple calls (same minute)', () => {
      const request = {
        action: 'EXECUTE_REMEDIATION',
        actor_id: 'agent-456',
        actor_type: 'agent' as const,
        resource: 'remediation:test:action',
        trace_id: 'trace-stability',
        correlation_id: 'corr-stability',
        policy_snapshot_hash: 'policy-stable-hash'
      };

      const decisions = Array.from({ length: 5 }, () => sandboxEngine.evaluate(request));

      const firstId = decisions[0].decision_id;
      decisions.forEach(d => {
        expect(d.decision_id).toBe(firstId);
      });
    });

    it('should not vary decision based on timing', () => {
      const request = {
        action: 'READ_SPLUNK_INDEX',
        actor_id: 'agent-789',
        actor_type: 'agent' as const,
        resource: 'splunk:index:main',
        trace_id: 'trace-timing',
        correlation_id: 'corr-timing',
        policy_snapshot_hash: 'policy-timing-hash'
      };

      const decision1 = sandboxEngine.evaluate(request);

      // Small delay
      const now = Date.now();
      while (Date.now() - now < 100) {
        // Busy wait to ensure some time passes
      }

      const decision2 = sandboxEngine.evaluate(request);

      // Decisions should be absolutely identical despite timing difference
      expect(decision1.decision).toBe(decision2.decision);
      expect(decision1.risk_level).toBe(decision2.risk_level);
      expect(decision1.matched_policy_ids).toEqual(decision2.matched_policy_ids);

      // CRITICAL: decision_id and input_fingerprint MUST be identical
      // This proves ABSOLUTE determinism, not time-window determinism
      expect(decision1.decision_id).toBe(decision2.decision_id);
      expect(decision1.input_fingerprint).toBe(decision2.input_fingerprint);
    });
  });

  describe('Canonicalization: Same semantic input → same decision', () => {
    it('should produce identical decisions for URLs with/without trailing slash', () => {
      const request1 = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-canon',
        actor_type: 'agent' as const,
        resource: 'splunk:config:https://144.202.48.85:8089',
        trace_id: 'trace-canon1',
        correlation_id: 'corr-canon',
        policy_snapshot_hash: 'policy-canon'
      };

      const request2 = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-canon',
        actor_type: 'agent' as const,
        resource: 'splunk:config:https://144.202.48.85:8089/',
        trace_id: 'trace-canon2',
        correlation_id: 'corr-canon',
        policy_snapshot_hash: 'policy-canon'
      };

      const decision1 = sandboxEngine.evaluate(request1);
      const decision2 = sandboxEngine.evaluate(request2);

      expect(decision1.decision).toBe(decision2.decision);
      expect(decision1.input_fingerprint).toBe(decision2.input_fingerprint);
    });

    it('should produce identical decisions for case variations in hostname', () => {
      const request1 = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-case',
        actor_type: 'agent' as const,
        resource: 'splunk:config:https://144.202.48.85:8089',
        trace_id: 'trace-case1',
        correlation_id: 'corr-case',
        policy_snapshot_hash: 'policy-case'
      };

      const request2 = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-case',
        actor_type: 'agent' as const,
        resource: 'splunk:config:HTTPS://144.202.48.85:8089',
        trace_id: 'trace-case2',
        correlation_id: 'corr-case',
        policy_snapshot_hash: 'policy-case'
      };

      const decision1 = sandboxEngine.evaluate(request1);
      const decision2 = sandboxEngine.evaluate(request2);

      expect(decision1.decision).toBe(decision2.decision);
      expect(decision1.input_fingerprint).toBe(decision2.input_fingerprint);
    });

    it('should block production IP regardless of URL format variations', () => {
      const prodUrls = [
        'https://45.76.167.6:8089',
        'https://45.76.167.6:8089/',
        'HTTPS://45.76.167.6:8089',
        'https://45.76.167.6'
      ];

      const decisions = prodUrls.map(url => {
        const request = {
          action: 'SAVE_SPLUNK_CONFIG',
          actor_id: 'agent-prod',
          actor_type: 'agent' as const,
          resource: `splunk:config:${url}`,
          trace_id: 'trace-prod-format',
          correlation_id: 'corr-prod',
          policy_snapshot_hash: 'policy-prod'
        };

        return sandboxEngine.evaluate(request);
      });

      // All should be DENY
      decisions.forEach(decision => {
        expect(decision.decision).toBe(Decision.DENY);
      });
    });
  });

  describe('Replay Consistency: Persist and replay decisions', () => {
    it('should reproduce identical decision from persisted input', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-replay',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-replay',
        correlation_id: 'corr-replay',
        policy_snapshot_hash: 'policy-replay-v1'
      };

      // First evaluation
      const decision1 = sandboxEngine.evaluate(request);

      // Simulate persistence and later replay
      const persistedDecision = {
        decision_id: decision1.decision_id,
        input_fingerprint: decision1.input_fingerprint,
        policy_snapshot_hash: decision1.policy_snapshot_hash
      };

      // Later: evaluate same request again
      const decision2 = sandboxEngine.evaluate(request);

      // Should be identical
      expect(decision2.decision_id).toBe(persistedDecision.decision_id);
      expect(decision2.input_fingerprint).toBe(persistedDecision.input_fingerprint);
    });
  });

  describe('Mutation Resistance: Any change → different decision', () => {
    it('should change decision_id when action changes', () => {
      const baseRequest = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-mutate',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-mutate',
        correlation_id: 'corr-mutate',
        policy_snapshot_hash: 'policy-mutate-v1'
      };

      const baseDecision = sandboxEngine.evaluate(baseRequest);
      const mutated = { ...baseRequest, action: 'EXECUTE_REMEDIATION' };
      const decision = sandboxEngine.evaluate(mutated);

      expect(decision.decision_id).not.toBe(baseDecision.decision_id);
      expect(decision.input_fingerprint).not.toBe(baseDecision.input_fingerprint);
    });

    it('should change decision_id when resource changes', () => {
      const baseRequest = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-mutate',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-mutate',
        correlation_id: 'corr-mutate',
        policy_snapshot_hash: 'policy-mutate-v1'
      };

      const baseDecision = sandboxEngine.evaluate(baseRequest);
      const mutated = { ...baseRequest, resource: 'splunk:config:different-host:8089' };
      const decision = sandboxEngine.evaluate(mutated);

      expect(decision.decision_id).not.toBe(baseDecision.decision_id);
      expect(decision.input_fingerprint).not.toBe(baseDecision.input_fingerprint);
    });

    it('should change decision_id when policy snapshot changes', () => {
      const baseRequest = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-mutate',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-mutate',
        correlation_id: 'corr-mutate',
        policy_snapshot_hash: 'policy-mutate-v1'
      };

      const baseDecision = sandboxEngine.evaluate(baseRequest);
      const mutated = { ...baseRequest, policy_snapshot_hash: 'policy-mutate-v2' };
      const decision = sandboxEngine.evaluate(mutated);

      expect(decision.decision_id).not.toBe(baseDecision.decision_id);
      expect(decision.input_fingerprint).not.toBe(baseDecision.input_fingerprint);
    });

    it('should change decision_id when actor changes', () => {
      const baseRequest = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-mutate',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-mutate',
        correlation_id: 'corr-mutate',
        policy_snapshot_hash: 'policy-mutate-v1'
      };

      const baseDecision = sandboxEngine.evaluate(baseRequest);
      const mutated = { ...baseRequest, actor_id: 'agent-different' };
      const decision = sandboxEngine.evaluate(mutated);

      expect(decision.decision_id).not.toBe(baseDecision.decision_id);
      expect(decision.input_fingerprint).not.toBe(baseDecision.input_fingerprint);
    });
  });

  describe('Input Fingerprint: Separate from decision_id', () => {
    it('should include input_fingerprint in decision', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-finger',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-finger',
        correlation_id: 'corr-finger',
        policy_snapshot_hash: 'policy-finger'
      };

      const decision = sandboxEngine.evaluate(request);

      expect(decision.input_fingerprint).toBeDefined();
      expect(decision.input_fingerprint.startsWith('input-')).toBe(true);
      expect(decision.input_fingerprint).not.toBe(decision.decision_id);
    });

    it('should enable forensic grouping: same input → same fingerprint', () => {
      const request = {
        action: 'SAVE_SPLUNK_CONFIG',
        actor_id: 'agent-group',
        actor_type: 'agent' as const,
        resource: 'splunk:config:144.202.48.85:8089',
        trace_id: 'trace-group-1',
        correlation_id: 'corr-group-1',
        policy_snapshot_hash: 'policy-group'
      };

      const decision1 = sandboxEngine.evaluate(request);

      // Different trace_id but same normalized input
      const request2 = {
        ...request,
        trace_id: 'trace-group-2',
        correlation_id: 'corr-group-2'
      };

      const decision2 = sandboxEngine.evaluate(request2);

      // Different decision_ids (due to different correlation context)
      // But same input_fingerprint (same normalized request)
      expect(decision1.input_fingerprint).toBe(decision2.input_fingerprint);
    });
  });
});
