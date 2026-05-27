/**
 * NORMALIZATION CONTRACT TESTS
 *
 * Ensures each normalizer (windows, syslog, cloud, generic) and the orchestrator
 * produce consistent canonical output for given inputs.
 *
 * Contract rules:
 *   1. Every sourcetype maps to exactly one canonical entry (never null)
 *   2. Generic normalizer never crashes or returns null
 *   3. Normalization is idempotent: running twice produces the same result
 *   4. Vital data (dailyGb, events) is preserved losslessly
 */

import { normalizeBatch, computeNormalizationDelta, validateCanonical } from '../../packages/core/normalization/index';
import { computeROIScore, computeGainScope, type ScoredSourcetype } from '../../packages/core/engine';

// ── Test Data Factories ─────────────────────────────────────────────────────

function makeEntry(overrides: {
  index?: string;
  sourcetype?: string | null;
  dailyAvgGb?: number;
  totalEvents?: number;
  retentionDays?: number;
  costPerGbPerDay?: number;
  precomputedScores?: Record<string, number | boolean | string>;
} = {}) {
  return {
    index: overrides.index ?? 'main',
    sourcetype: overrides.sourcetype ?? null,
    dailyAvgGb: overrides.dailyAvgGb ?? 10,
    totalEvents: overrides.totalEvents ?? 1_000_000,
    retentionDays: overrides.retentionDays ?? 90,
    costPerGbPerDay: overrides.costPerGbPerDay ?? 0.5,
    precomputedScores: overrides.precomputedScores ? {
      utilizationScore: Number(overrides.precomputedScores.utilizationScore ?? 50),
      detectionScore: Number(overrides.precomputedScores.detectionScore ?? 50),
      qualityScore: Number(overrides.precomputedScores.qualityScore ?? 50),
      compositeScore: Number(overrides.precomputedScores.compositeScore ?? 50),
      tier: String(overrides.precomputedScores.tier ?? 'Important'),
      detectionGap: Boolean(overrides.precomputedScores.detectionGap ?? false),
      operationalGap: Boolean(overrides.precomputedScores.operationalGap ?? false),
      alertCount: Number(overrides.precomputedScores.alertCount ?? 0),
      scheduledSearchCount: Number(overrides.precomputedScores.scheduledSearchCount ?? 0),
      dashboardPanelCount: Number(overrides.precomputedScores.dashboardPanelCount ?? 0),
      distinctUserCount: Number(overrides.precomputedScores.distinctUserCount ?? 0),
      adHocSearchCount: Number(overrides.precomputedScores.adHocSearchCount ?? 0),
      mitreTechniqueCount: Number(overrides.precomputedScores.mitreTechniqueCount ?? 0),
      lanternUsecaseCount: Number(overrides.precomputedScores.lanternUsecaseCount ?? 0),
      activeAlertCount: Number(overrides.precomputedScores.activeAlertCount ?? 0),
      weightedIssues: Number(overrides.precomputedScores.weightedIssues ?? 0),
    } : undefined,
  };
}

function makeScored(overrides: Partial<ScoredSourcetype> = {}): ScoredSourcetype {
  return {
    index: 'test', sourcetype: null,
    utilizationScore: 50, detectionScore: 50, qualityScore: 50,
    compositeScore: 50, tier: 'Important', dailyGb: 10,
    annualCostUsd: 1000, detectionGap: false, operationalGap: false,
    ...overrides,
  };
}

// ─── Windows Event Log Normalization ────────────────────────────────────────

describe('Normalization Contract: Windows Event Log', () => {
  it('WinEventLog:Security → windows_security (security category, HIGH confidence)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'WinEventLog:Security' })]);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].sourceType).toBe('windows_security');
    expect(canonical[0].category).toBe('security');
    expect(canonical[0].channel).toBe('security');
    expect(canonical[0].confidence).toBe('HIGH');
  });

  it('WinEventLog:System → windows_system (endpoint category)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'WinEventLog:System' })]);
    expect(canonical[0].sourceType).toBe('windows_system');
    expect(canonical[0].category).toBe('endpoint');
    expect(canonical[0].channel).toBe('system');
  });

  it('WinEventLog:Application → windows_application (application category)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'WinEventLog:Application' })]);
    expect(canonical[0].sourceType).toBe('windows_application');
    expect(canonical[0].category).toBe('application');
  });

  it('WinEventLog:Powershell → windows_powershell (security category)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'WinEventLog:Powershell' })]);
    expect(canonical[0].sourceType).toBe('windows_powershell');
    expect(canonical[0].category).toBe('security');
    expect(canonical[0].confidence).toBe('HIGH');
  });

  it('WinEventLog:Sysmon → windows_sysmon (security category)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'WinEventLog:Sysmon' })]);
    expect(canonical[0].sourceType).toBe('windows_sysmon');
    expect(canonical[0].category).toBe('security');
  });

  it('Unknown Windows channel falls to generic endpoint with LOW confidence', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'WinEventLog:Hyper-V' })]);
    expect(canonical[0].sourceType).toBe('windows_hyper-v');
    expect(canonical[0].category).toBe('endpoint');
    expect(canonical[0].confidence).toBe('LOW');
  });

  it('Non-Windows sourcetype returns null from windows normalizer (falls through)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'linux_secure' })]);
    expect(canonical[0].sourceType).not.toMatch(/^windows_/);
  });

  it('Windows security channel detection counts are not mixed with application channel', () => {
    const { canonical } = normalizeBatch([
      makeEntry({ sourcetype: 'WinEventLog:Security', precomputedScores: { alertCount: 15, mitreTechniqueCount: 8 } }),
      makeEntry({ sourcetype: 'WinEventLog:Application', precomputedScores: { alertCount: 3, mitreTechniqueCount: 1 } }),
    ]);
    const security = canonical.find(c => c.sourceType === 'windows_security')!;
    const app = canonical.find(c => c.sourceType === 'windows_application')!;
    expect(security.detectionInputs.mitreTechniqueCount).toBe(8);
    expect(app.detectionInputs.mitreTechniqueCount).toBe(1);
    expect(security.utilizationInputs.alertCount).toBe(15);
    expect(app.utilizationInputs.alertCount).toBe(3);
  });
});

// ─── Syslog / Network Device Normalization ──────────────────────────────────

describe('Normalization Contract: Syslog / Network', () => {
  it('cisco:asa → cisco_asa (network/firewall)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'cisco:asa' })]);
    expect(canonical[0].sourceType).toBe('cisco_asa');
    expect(canonical[0].category).toBe('network');
    expect(canonical[0].channel).toBe('firewall');
    expect(canonical[0].confidence).toBe('HIGH');
  });

  it('pan:traffic → pan_traffic (network/firewall)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'pan:traffic' })]);
    expect(canonical[0].sourceType).toBe('pan_traffic');
    expect(canonical[0].category).toBe('network');
    expect(canonical[0].channel).toBe('firewall');
  });

  it('pan:threat → pan_threat (security/ids)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'pan:threat' })]);
    expect(canonical[0].sourceType).toBe('pan_threat');
    expect(canonical[0].category).toBe('security');
    expect(canonical[0].channel).toBe('ids');
  });

  it('linux_secure → linux_secure (infra/auth)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'linux_secure' })]);
    expect(canonical[0].sourceType).toBe('linux_secure');
    expect(canonical[0].category).toBe('infra');
    expect(canonical[0].channel).toBe('auth');
  });

  it('unknown syslog prefix falls to generic normalizer', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'zxy_unknown_telemetry' })]);
    expect(canonical[0].sourceType).toMatch(/^generic_/);
    expect(canonical[0].category).toBe('generic');
    expect(canonical[0].confidence).toBe('LOW');
  });

  it('fortigate → fortigate (network/firewall)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'fortigate' })]);
    expect(canonical[0].sourceType).toBe('fortigate');
    expect(canonical[0].category).toBe('network');
  });

  it('authlog → authlog (infra/auth)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'authlog' })]);
    expect(canonical[0].sourceType).toBe('authlog');
    expect(canonical[0].channel).toBe('auth');
  });

  it('ssh* prefix → ssh (infra/auth) with MEDIUM confidence', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'ssh_auth' })]);
    expect(canonical[0].sourceType).toBe('ssh');
    expect(canonical[0].confidence).toBe('MEDIUM');
  });

  it('nginx* prefix → nginx (application/web)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'nginx_access' })]);
    expect(canonical[0].sourceType).toBe('nginx');
    expect(canonical[0].category).toBe('application');
  });
});

// ─── Cloud Platform Normalization ───────────────────────────────────────────

describe('Normalization Contract: Cloud Platforms', () => {
  it('aws:cloudtrail → aws_cloudtrail (cloud/audit)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'aws:cloudtrail' })]);
    expect(canonical[0].sourceType).toBe('aws_cloudtrail');
    expect(canonical[0].category).toBe('cloud');
    expect(canonical[0].channel).toBe('audit');
    expect(canonical[0].confidence).toBe('HIGH');
  });

  it('aws:guardduty → aws_guardduty (security/threat_detection)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'aws:guardduty' })]);
    expect(canonical[0].category).toBe('security');
    expect(canonical[0].channel).toBe('threat_detection');
  });

  it('azure:audit → azure_audit (cloud/audit)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'azure:audit' })]);
    expect(canonical[0].sourceType).toBe('azure_audit');
    expect(canonical[0].category).toBe('cloud');
  });

  it('gcp:audit → gcp_audit (cloud/audit)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'gcp:audit' })]);
    expect(canonical[0].sourceType).toBe('gcp_audit');
  });

  it('o365:management → o365_management (cloud/identity)', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'o365:management' })]);
    expect(canonical[0].sourceType).toBe('o365_management');
    expect(canonical[0].category).toBe('cloud');
    expect(canonical[0].channel).toBe('identity');
  });

  it('unknown cloud prefix falls through to generic', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'azure:unknown_service' })]);
    // azure:unknown_service doesn't match any cloud entry → falls through
    // azure:* doesn't have a prefix match → falls to generic
    expect(canonical[0].sourceType).toMatch(/^generic_/);
  });
});

// ─── Generic Fallback ───────────────────────────────────────────────────────

describe('Normalization Contract: Generic Fallback', () => {
  it('null sourcetype produces generic canonical entry (never throws)', () => {
    const { canonical, errors } = normalizeBatch([makeEntry({ sourcetype: null })]);
    expect(errors).toHaveLength(0);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].sourceType).toMatch(/^generic_/);
    expect(canonical[0].confidence).toBe('LOW');
  });

  it('empty string sourcetype produces generic canonical entry', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: '' })]);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].confidence).toBe('LOW');
  });

  it('undefined sourcetype produces generic canonical entry', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: undefined })]);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].confidence).toBe('LOW');
  });

  it('special characters are sanitized from generic key', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'My Custom $$ App v2.0!' })]);
    // Underscores collapse, trailing underscores removed
    expect(canonical[0].sourceType).toBe('generic_my_custom_app_v2_0');
    // Should not contain raw special characters
    expect(canonical[0].sourceType).not.toContain('$');
    expect(canonical[0].sourceType).not.toContain('!');
  });

  it('volume and events are preserved in generic fallback', () => {
    const { canonical } = normalizeBatch([makeEntry({
      sourcetype: 'custom_app',
      dailyAvgGb: 42.5,
      totalEvents: 5_000_000,
    })]);
    expect(canonical[0].volumeGb).toBe(42.5);
    expect(canonical[0].events).toBe(5_000_000);
  });

  it('generic fallback infers plausible category from key characteristics', () => {
    const kube = normalizeBatch([makeEntry({ sourcetype: 'kube_system' })]);
    expect(kube.canonical[0].category).toBe('infra');

    const db = normalizeBatch([makeEntry({ sourcetype: 'database_audit' })]);
    expect(db.canonical[0].category).toBe('application');

    const fw = normalizeBatch([makeEntry({ sourcetype: 'firewall_logs' })]);
    expect(fw.canonical[0].category).toBe('network');

    const audit = normalizeBatch([makeEntry({ sourcetype: 'compliance_audit' })]);
    expect(audit.canonical[0].category).toBe('security');
  });
});

// ─── Batch Normalization ────────────────────────────────────────────────────

describe('Normalization Contract: Batch Processing', () => {
  it('normalizes a mixed batch correctly', () => {
    const { canonical, errors } = normalizeBatch([
      makeEntry({ sourcetype: 'WinEventLog:Security' }),
      makeEntry({ sourcetype: 'WinEventLog:System' }),
      makeEntry({ sourcetype: 'linux_secure' }),
      makeEntry({ sourcetype: 'aws:cloudtrail' }),
      makeEntry({ sourcetype: 'cisco:asa' }),
      makeEntry({ sourcetype: 'custom_unknown' }),
    ]);
    expect(errors).toHaveLength(0);
    expect(canonical).toHaveLength(6);
    expect(canonical[0].sourceType).toBe('windows_security');
    expect(canonical[1].sourceType).toBe('windows_system');
    expect(canonical[2].sourceType).toBe('linux_secure');
    expect(canonical[3].sourceType).toBe('aws_cloudtrail');
    expect(canonical[4].sourceType).toBe('cisco_asa');
    expect(canonical[5].sourceType).toMatch(/^generic_/);
  });

  it('orders do not affect normalization result (sourcetype → canonical is deterministic)', () => {
    const batch1 = normalizeBatch([
      makeEntry({ sourcetype: 'WinEventLog:Security' }),
      makeEntry({ sourcetype: 'linux_secure' }),
    ]);
    const batch2 = normalizeBatch([
      makeEntry({ sourcetype: 'linux_secure' }),
      makeEntry({ sourcetype: 'WinEventLog:Security' }),
    ]);
    const s1 = batch1.canonical.find(c => c.sourceType === 'windows_security')!;
    const s2 = batch2.canonical.find(c => c.sourceType === 'windows_security')!;
    expect(s1.category).toBe(s2.category);
    expect(s1.volumeGb).toBe(s2.volumeGb);
    expect(s1.confidence).toBe(s2.confidence);
  });

  it('every entry in batch preserves its raw metadata', () => {
    const { canonical } = normalizeBatch([
      makeEntry({ index: 'idx1', sourcetype: 'WinEventLog:Security' }),
      makeEntry({ index: 'idx2', sourcetype: 'cisco:asa' }),
    ]);
    const security = canonical.find(c => c.sourceType === 'windows_security')!;
    const cisco = canonical.find(c => c.sourceType === 'cisco_asa')!;
    expect(security.raw.index).toBe('idx1');
    expect(cisco.raw.index).toBe('idx2');
  });
});

// ─── Idempotency (Historical Replay) ────────────────────────────────────────

describe('Normalization Contract: Idempotency / Historical Replay', () => {
  it('normalizing the same input twice produces identical results', () => {
    const input = makeEntry({ sourcetype: 'WinEventLog:Security', dailyAvgGb: 15, totalEvents: 2_000_000 });
    const first = normalizeBatch([input]);
    const second = normalizeBatch([input]);
    expect(first.canonical[0].sourceType).toBe(second.canonical[0].sourceType);
    expect(first.canonical[0].category).toBe(second.canonical[0].category);
    expect(first.canonical[0].volumeGb).toBe(second.canonical[0].volumeGb);
    expect(first.canonical[0].events).toBe(second.canonical[0].events);
    expect(first.canonical[0].confidence).toBe(second.canonical[0].confidence);
  });

  it('normalizing previously normalized canonical input re-runs through generic (no double-match)', () => {
    // Canonical sourcetypes like "windows_security" don't match any normalizer
    // pattern and should fall through to generic
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'windows_security' })]);
    expect(canonical[0].sourceType).toMatch(/^generic_/);
  });
});

// ─── Contract Validation ────────────────────────────────────────────────────

describe('Normalization Contract: validateCanonical', () => {
  it('rejects invalid category', () => {
    const bad: any = {
      sourceType: 'test', category: 'invalid_category',
      volumeGb: 10, events: 100, confidence: 'HIGH',
      utilizationInputs: { index: 'main', sourcetype: 'test', alertCount: 0, scheduledSearchCount: 0, dashboardPanelCount: 0, distinctUserCount: 0, adHocSearchCount: 0 },
      detectionInputs: { index: 'main', sourcetype: 'test', mitreTechniqueCount: 0, lanternUsecaseCount: 0, activeAlertCount: 0 },
      qualityInputs: { index: 'main', sourcetype: 'test', weightedIssues: 0, dailyGb: 10 },
      raw: {},
    };
    const errors = validateCanonical(bad);
    expect(errors.some((e: string) => e.includes('Invalid category'))).toBe(true);
  });

  it('rejects negative volumeGb', () => {
    const bad: any = {
      sourceType: 'test', category: 'generic',
      volumeGb: -5, events: 100, confidence: 'HIGH',
      utilizationInputs: { index: 'main', sourcetype: 'test', alertCount: 0, scheduledSearchCount: 0, dashboardPanelCount: 0, distinctUserCount: 0, adHocSearchCount: 0 },
      detectionInputs: { index: 'main', sourcetype: 'test', mitreTechniqueCount: 0, lanternUsecaseCount: 0, activeAlertCount: 0 },
      qualityInputs: { index: 'main', sourcetype: 'test', weightedIssues: 0, dailyGb: 10 },
      raw: {},
    };
    const errors = validateCanonical(bad);
    expect(errors.some((e: string) => e.includes('volumeGb'))).toBe(true);
  });

  it('rejects invalid confidence value', () => {
    const bad: any = {
      sourceType: 'test', category: 'generic',
      volumeGb: 10, events: 100, confidence: 'ULTRA',
      utilizationInputs: { index: 'main', sourcetype: 'test', alertCount: 0, scheduledSearchCount: 0, dashboardPanelCount: 0, distinctUserCount: 0, adHocSearchCount: 0 },
      detectionInputs: { index: 'main', sourcetype: 'test', mitreTechniqueCount: 0, lanternUsecaseCount: 0, activeAlertCount: 0 },
      qualityInputs: { index: 'main', sourcetype: 'test', weightedIssues: 0, dailyGb: 10 },
      raw: {},
    };
    const errors = validateCanonical(bad);
    expect(errors.some((e: string) => e.includes('confidence'))).toBe(true);
  });

  it('valid canonical entry passes validation with no errors', () => {
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: 'WinEventLog:Security' })]);
    const errors = validateCanonical(canonical[0]);
    expect(errors).toHaveLength(0);
  });
});

// ─── KPI Variance (Normalization Delta) ─────────────────────────────────────

describe('Normalization Contract: KPI Variance / Normalization Delta', () => {
  const oldKpis = { roiScore: 60, gainScope: 45, tierCounts: { critical: 2, important: 3, niceToHave: 1, lowValue: 1 } };
  const newKpis = { roiScore: 55, gainScope: 40, tierCounts: { critical: 1, important: 3, niceToHave: 2, lowValue: 1 } };

  it('computes ROI variance correctly', () => {
    const delta = computeNormalizationDelta(oldKpis, newKpis, 10, 2, 0);
    const expectedVariance = (5 / 60) * 100; // ≈ 8.33%
    expect(delta.roiVariance).toBeCloseTo(expectedVariance, 1);
  });

  it('computes GainScope variance correctly', () => {
    const delta = computeNormalizationDelta(oldKpis, newKpis, 10, 2, 0);
    const expectedVariance = (5 / 45) * 100; // ≈ 11.11%
    expect(delta.gainScopeVariance).toBeCloseTo(expectedVariance, 1);
  });

  it('returns 0 variance when old KPI is 0', () => {
    const zeroOld = { roiScore: 0, gainScope: 0, tierCounts: { critical: 0, important: 0, niceToHave: 0, lowValue: 0 } };
    const delta = computeNormalizationDelta(zeroOld, newKpis, 10, 2, 0);
    expect(delta.roiVariance).toBe(0);
    expect(delta.gainScopeVariance).toBe(0);
  });

  it('reports normalized count, generic count, and error count', () => {
    const delta = computeNormalizationDelta(oldKpis, newKpis, 15, 3, 1);
    expect(delta.normalizedCount).toBe(15);
    expect(delta.genericCount).toBe(3);
    expect(delta.errorCount).toBe(1);
  });

  it('tier counts are preserved in delta', () => {
    const delta = computeNormalizationDelta(oldKpis, newKpis, 10, 2, 0);
    expect(delta.oldTierCounts.critical).toBe(2);
    expect(delta.newTierCounts.critical).toBe(1);
    expect(delta.oldTierCounts.important).toBe(3);
    expect(delta.newTierCounts.important).toBe(3);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('Normalization Contract: Edge Cases', () => {
  it('empty batch returns empty canonical array', () => {
    const { canonical, errors } = normalizeBatch([]);
    expect(canonical).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('special characters in sourcetype do not cause crash', () => {
    const { canonical, errors } = normalizeBatch([makeEntry({ sourcetype: '🔥emoji_test!' })]);
    expect(errors).toHaveLength(0);
    expect(canonical).toHaveLength(1);
  });

  it('very long sourcetype string does not cause truncation issues', () => {
    const long = 'a'.repeat(500);
    const { canonical } = normalizeBatch([makeEntry({ sourcetype: long })]);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].sourceType.length).toBeLessThan(600);
  });

  it('multiple identical sourcetypes produce separate canonical entries', () => {
    const { canonical } = normalizeBatch([
      makeEntry({ index: 'idx1', sourcetype: 'WinEventLog:Security' }),
      makeEntry({ index: 'idx2', sourcetype: 'WinEventLog:Security' }),
    ]);
    expect(canonical).toHaveLength(2);
    expect(canonical[0].sourceType).toBe('windows_security');
    expect(canonical[1].sourceType).toBe('windows_security');
    // Different indexes should not collapse
    expect(canonical[0].raw.index).toBe('idx1');
    expect(canonical[1].raw.index).toBe('idx2');
  });
});
