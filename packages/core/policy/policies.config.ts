/**
 * POLICY CONFIGURATIONS
 * Production rule definitions for different governance profiles
 */

import type { PolicyConfig, PolicyRule } from './types';
import { createDefaultGuardrails } from './guardrails';

/**
 * COST-OPTIMIZATION PROFILE
 * Aggressive elimination of low-value sources
 */
export const COST_OPTIMIZATION_POLICY: PolicyConfig = {
  version: '1.0.0',
  defaultDecision: 'MONITOR',
  escalationThreshold: 0.3,
  guardrails: createDefaultGuardrails(),
  rules: [
    {
      id: 'rule-tier-4-eliminate',
      name: 'Eliminate Tier 4 (Low-Value)',
      description: 'Automatically eliminate low-value sources with minimal impact',
      severity: 'MEDIUM',
      conditions: [
        {
          field: 'tier',
          operator: 'eq',
          value: 'Low-Value',
          description: 'Tier 4 (Low-Value)',
        },
        {
          field: 'annualCostUsd',
          operator: 'gt',
          value: 1000,
          description: 'Cost > $1k/year',
        },
      ],
      decision: 'ELIMINATE',
    },
    {
      id: 'rule-low-utilization-monitor',
      name: 'Monitor Low Utilization',
      description: 'Monitor sources with minimal usage to validate before elimination',
      severity: 'LOW',
      conditions: [
        {
          field: 'utilizationScore',
          operator: 'lt',
          value: 20,
          description: 'Utilization < 20',
        },
        {
          field: 'compositeScore',
          operator: 'lt',
          value: 35,
          description: 'Composite < 35',
        },
      ],
      decision: 'MONITOR',
      blockedDecisions: ['RETAIN'],
    },
    {
      id: 'rule-stale-eliminate',
      name: 'Eliminate Stale Sources',
      description: 'Eliminate sources with no recent activity and low composite score',
      severity: 'MEDIUM',
      conditions: [
        {
          field: 'utilizationScore',
          operator: 'lt',
          value: 5,
          description: 'Utilization < 5',
        },
        {
          field: 'compositeScore',
          operator: 'lt',
          value: 20,
          description: 'Composite < 20',
        },
      ],
      decision: 'ELIMINATE',
    },
  ],
};

/**
 * SECURITY-FIRST PROFILE
 * Prioritize detection coverage, strict guardrails
 */
export const SECURITY_FIRST_POLICY: PolicyConfig = {
  version: '1.0.0',
  defaultDecision: 'RETAIN',
  escalationThreshold: 0.7,
  guardrails: createDefaultGuardrails(),
  rules: [
    {
      id: 'rule-high-detection-retain',
      name: 'Retain High Detection Coverage',
      description: 'Always retain sources with critical threat detection',
      severity: 'CRITICAL',
      conditions: [
        {
          field: 'detectionScore',
          operator: 'gte',
          value: 75,
          description: 'Detection >= 75',
        },
      ],
      decision: 'RETAIN',
      blockedDecisions: ['ELIMINATE'],
    },
    {
      id: 'rule-medium-detection-monitor',
      name: 'Monitor Medium Detection',
      description: 'Monitor sources with moderate detection before any action',
      severity: 'HIGH',
      conditions: [
        {
          field: 'detectionScore',
          operator: 'gte',
          value: 40,
          operator: 'lt',
          value: 75,
          description: 'Detection 40-75',
        },
      ],
      decision: 'MONITOR',
      allowedDecisions: ['MONITOR', 'RETAIN', 'ESCALATE'],
    },
    {
      id: 'rule-quality-issues-remediate',
      name: 'Quality Issues Must Be Resolved',
      description: 'Flag sources with quality issues for remediation',
      severity: 'HIGH',
      conditions: [
        {
          field: 'qualityScore',
          operator: 'lt',
          value: 60,
          description: 'Quality < 60',
        },
      ],
      decision: 'ESCALATE',
      allowedDecisions: ['ESCALATE', 'REBALANCE'],
    },
  ],
};

/**
 * OPERATIONS-FOCUSED PROFILE
 * Balance cost and utility, minimize disruption
 */
export const OPERATIONS_FOCUSED_POLICY: PolicyConfig = {
  version: '1.0.0',
  defaultDecision: 'MONITOR',
  escalationThreshold: 0.5,
  guardrails: createDefaultGuardrails(),
  rules: [
    {
      id: 'rule-critical-retain',
      name: 'Retain Critical Sources',
      description: 'Always retain Tier 1 and Tier 2 sources',
      severity: 'CRITICAL',
      conditions: [
        {
          field: 'tier',
          operator: 'in',
          value: ['Critical', 'Important'],
          description: 'Tier 1 or Tier 2',
        },
      ],
      decision: 'RETAIN',
      blockedDecisions: ['ELIMINATE'],
    },
    {
      id: 'rule-nice-to-have-monitor',
      name: 'Monitor Nice-to-Have',
      description: 'Monitor Tier 3 (Nice-to-Have) sources for efficiency',
      severity: 'MEDIUM',
      conditions: [
        {
          field: 'tier',
          operator: 'eq',
          value: 'Nice-to-Have',
          description: 'Tier 3',
        },
      ],
      decision: 'MONITOR',
      allowedDecisions: ['MONITOR', 'REBALANCE'],
    },
    {
      id: 'rule-low-value-rebalance',
      name: 'Rebalance Low-Value Sources',
      description: 'Attempt to consolidate low-value sources instead of elimination',
      severity: 'LOW',
      conditions: [
        {
          field: 'tier',
          operator: 'eq',
          value: 'Low-Value',
          description: 'Tier 4',
        },
        {
          field: 'annualCostUsd',
          operator: 'lt',
          value: 10000,
          description: 'Cost < $10k/year',
        },
      ],
      decision: 'REBALANCE',
      allowedDecisions: ['REBALANCE', 'MONITOR'],
    },
  ],
};

/**
 * CONSERVATIVE PROFILE
 * Minimal action, escalate all changes
 */
export const CONSERVATIVE_POLICY: PolicyConfig = {
  version: '1.0.0',
  defaultDecision: 'MONITOR',
  escalationThreshold: 0.2,
  guardrails: createDefaultGuardrails(),
  rules: [
    {
      id: 'rule-everything-escalate',
      name: 'Escalate All Non-Monitoring Decisions',
      description: 'Any recommended change beyond MONITOR must be escalated',
      severity: 'HIGH',
      conditions: [
        {
          field: 'compositeScore',
          operator: 'gte',
          value: 0,
          description: 'All sources',
        },
      ],
      allowedDecisions: ['MONITOR', 'ESCALATE'],
      blockedDecisions: ['ELIMINATE', 'REBALANCE'],
    },
  ],
};

/**
 * DATA-QUALITY-FOCUSED PROFILE
 * Emphasize quality scores, resolve issues before elimination
 */
export const DATA_QUALITY_POLICY: PolicyConfig = {
  version: '1.0.0',
  defaultDecision: 'MONITOR',
  escalationThreshold: 0.6,
  guardrails: createDefaultGuardrails(),
  rules: [
    {
      id: 'rule-quality-issues-flag',
      name: 'Flag Quality Issues',
      description: 'Any quality score < 70 requires remediation action',
      severity: 'CRITICAL',
      conditions: [
        {
          field: 'qualityScore',
          operator: 'lt',
          value: 70,
          description: 'Quality < 70',
        },
      ],
      decision: 'ESCALATE',
      blockedDecisions: ['ELIMINATE'],
    },
    {
      id: 'rule-good-quality-eligible',
      name: 'Quality-Approved for Action',
      description: 'Only sources with quality >= 70 are eligible for optimization decisions',
      severity: 'MEDIUM',
      conditions: [
        {
          field: 'qualityScore',
          operator: 'gte',
          value: 70,
          description: 'Quality >= 70',
        },
        {
          field: 'compositeScore',
          operator: 'lt',
          value: 30,
          description: 'Composite < 30',
        },
      ],
      decision: 'REBALANCE',
      allowedDecisions: ['REBALANCE', 'MONITOR', 'ELIMINATE'],
    },
  ],
};

/**
 * POLICY REGISTRY
 * Map profile names to configs
 */
export const POLICY_PROFILES = {
  cost_optimization: COST_OPTIMIZATION_POLICY,
  security_first: SECURITY_FIRST_POLICY,
  operations_focused: OPERATIONS_FOCUSED_POLICY,
  conservative: CONSERVATIVE_POLICY,
  data_quality: DATA_QUALITY_POLICY,
};

/**
 * Get policy by profile name
 */
export function getPolicyByProfile(profileName: keyof typeof POLICY_PROFILES): PolicyConfig {
  const config = POLICY_PROFILES[profileName];
  if (!config) {
    throw new Error(`Unknown policy profile: ${profileName}`);
  }
  return config;
}
