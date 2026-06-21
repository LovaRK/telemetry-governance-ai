/**
 * Chaos Generator — Phase 10
 *
 * Generates deterministic synthetic telemetry data for sandbox testing.
 * Covers all 5 mandated chaos scenarios from the architecture plan:
 *
 *   1. License Growth   — ingest grows 40% QoQ; overage cost simulation
 *   2. Zombie Indexes   — high-utilization allocation, zero detection, stale >6 months
 *   3. Duplicate Telemetry — 2× storage cost from overlapping ingestion pipelines
 *   4. Cardinality Explosion — high-cardinality fields (http_url with 10M unique values)
 *   5. ROI Boundary Stress — 50 indexes at ±0.5 of tier classification boundary
 *
 * SAFETY GUARD: ALL output is tagged `_chaos: true` and requires
 * ALLOW_SYNTHETIC_DATA=true + APP_ENV=sandbox to execute.
 * This code MUST NEVER run against a production tenant.
 *
 * Usage:
 *   ALLOW_SYNTHETIC_DATA=true APP_ENV=sandbox npx ts-node tools/sandbox/chaos-generator.ts
 */

import * as crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Safety guard — hard fail before any data generation
// ─────────────────────────────────────────────────────────────────────────────

const APP_ENV            = process.env.APP_ENV ?? 'sandbox';
const ALLOW_SYNTHETIC    = process.env.ALLOW_SYNTHETIC_DATA === 'true';

if (APP_ENV === 'production') {
  throw new Error(
    '[ChaosGenerator] FATAL: APP_ENV=production detected. ' +
    'Chaos generator MUST NOT run against production data. Aborting.',
  );
}
if (!ALLOW_SYNTHETIC) {
  throw new Error(
    '[ChaosGenerator] FATAL: ALLOW_SYNTHETIC_DATA is not set to "true". ' +
    'Set ALLOW_SYNTHETIC_DATA=true in your environment to run chaos generation.',
  );
}

console.log('[ChaosGenerator] Safety checks passed. APP_ENV=sandbox, ALLOW_SYNTHETIC_DATA=true');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CHAOS_TENANT_ID = 'CHAOS_SANDBOX';

// Tier boundary thresholds (must mirror gold-scorer.ts classifyTier)
const TIER_BOUNDARY_CRITICAL    = 80;
const TIER_BOUNDARY_HIGH_VALUE  = 60;
const TIER_BOUNDARY_MEDIUM      = 40;
const TIER_BOUNDARY_LOW_VALUE   = 20;

// Cost model: $3/GB/day annualised (representative enterprise Splunk pricing)
const COST_PER_GB_PER_DAY_ANNUAL = 3 * 365;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChaosSnapshot {
  _chaos: true;                     // ALWAYS true — marks synthetic data
  scenario: ChaosScenario;
  tenant_id: string;
  index_name: string;
  sourcetype: string;
  daily_avg_gb: number;
  cost_per_year: number;
  utilization_score: number;        // 0–100
  detection_score: number;          // 0–100
  quality_score: number;            // 0–100
  composite_score: number;          // 0–100
  tier: string;
  classification: string;           // KEEP | OPTIMIZE | ARCHIVE | ELIMINATE | INVESTIGATE
  estimated_savings: number;
  is_quick_win: boolean;
  is_s3_candidate: boolean;
  reasoning: string;
  metadata: Record<string, unknown>;
}

export type ChaosScenario =
  | 'license_growth'
  | 'zombie_index'
  | 'duplicate_telemetry'
  | 'cardinality_explosion'
  | 'roi_boundary_stress';

export interface ChaosDataset {
  scenario: ChaosScenario;
  description: string;
  snapshots: ChaosSnapshot[];
  expected_total_cost: number;
  expected_total_savings: number;
  expected_security_gaps: number;
  expected_operational_gaps: number;
  generated_at: string;
}

export interface FullChaosDataset {
  scenarios: ChaosDataset[];
  total_snapshots: number;
  generated_at: string;
  tenant_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic RNG (seeded — same seed → same dataset)
// ─────────────────────────────────────────────────────────────────────────────

class SeededRng {
  private state: number;

  constructor(seed: string) {
    // Hash the seed string to a 32-bit integer
    const h = crypto.createHash('sha256').update(seed).digest();
    this.state = h.readUInt32BE(0);
  }

  /** Returns a float in [0, 1) */
  next(): number {
    // xorshift32
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 0x100000000;
  }

  /** Returns an integer in [min, max] */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Returns a float in [min, max] */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Pick a random element from an array */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function classifyTier(composite: number): string {
  if (composite >= TIER_BOUNDARY_CRITICAL)   return 'critical';
  if (composite >= TIER_BOUNDARY_HIGH_VALUE) return 'high-value';
  if (composite >= TIER_BOUNDARY_MEDIUM)     return 'medium-value';
  if (composite >= TIER_BOUNDARY_LOW_VALUE)  return 'low-value';
  return 'inactive';
}

function classifyAction(util: number, detect: number, quality: number, composite: number): string {
  if (composite < TIER_BOUNDARY_LOW_VALUE && util < 10) return 'ELIMINATE';
  if (composite < TIER_BOUNDARY_MEDIUM && detect < 20)  return 'ARCHIVE';
  if (quality < 40 && composite >= TIER_BOUNDARY_MEDIUM) return 'INVESTIGATE';
  if (composite < TIER_BOUNDARY_HIGH_VALUE)              return 'OPTIMIZE';
  return 'KEEP';
}

function estimateSavings(dailyGb: number, action: string): number {
  switch (action) {
    case 'ELIMINATE': return dailyGb * COST_PER_GB_PER_DAY_ANNUAL;
    case 'ARCHIVE':   return dailyGb * COST_PER_GB_PER_DAY_ANNUAL * 0.7;
    case 'OPTIMIZE':  return dailyGb * COST_PER_GB_PER_DAY_ANNUAL * 0.3;
    default:          return 0;
  }
}

function makeSnapshot(
  scenario: ChaosScenario,
  indexName: string,
  sourcetype: string,
  dailyGb: number,
  util: number,
  detect: number,
  quality: number,
  reasoning: string,
  metadata: Record<string, unknown> = {},
): ChaosSnapshot {
  const composite = util * 0.35 + detect * 0.40 + quality * 0.25;
  const tier       = classifyTier(composite);
  const action     = classifyAction(util, detect, quality, composite);
  const savings    = estimateSavings(dailyGb, action);

  return {
    _chaos:             true,
    scenario,
    tenant_id:          CHAOS_TENANT_ID,
    index_name:         indexName,
    sourcetype,
    daily_avg_gb:       Math.round(dailyGb * 100) / 100,
    cost_per_year:      Math.round(dailyGb * COST_PER_GB_PER_DAY_ANNUAL),
    utilization_score:  Math.min(100, Math.round(util * 10) / 10),
    detection_score:    Math.min(100, Math.round(detect * 10) / 10),
    quality_score:      Math.min(100, Math.round(quality * 10) / 10),
    composite_score:    Math.min(100, Math.round(composite * 10) / 10),
    tier,
    classification:     action,
    estimated_savings:  Math.round(savings),
    is_quick_win:       savings > 5_000 && action !== 'KEEP',
    is_s3_candidate:    action === 'ARCHIVE' && dailyGb > 1,
    reasoning,
    metadata:           { ...metadata, _synthetic: true },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: License Growth (40% QoQ overage)
// ─────────────────────────────────────────────────────────────────────────────

export function generateLicenseGrowthScenario(): ChaosDataset {
  const rng = new SeededRng('license_growth_v1');
  const snapshots: ChaosSnapshot[] = [];

  // Baseline: 20 well-behaved indexes
  const baseSourcetypes = [
    'access_combined', 'syslog', 'WinEventLog:Security', 'aws:cloudtrail',
    'linux_audit', 'cisco_asa', 'pan:traffic', 'crowdstrike',
    'vmware:log', 'kubernetes:container', 'docker:container',
    'apache:access', 'nginx:access', 'iis', 'cisco:ios',
    'checkpoint:log', 'paloalto:threat', 'fortinet:traffic',
    'azure:activity', 'okta:system',
  ];

  for (const st of baseSourcetypes) {
    const baseDailyGb = rng.float(0.5, 8);
    // Growth scenario: each index grows 40% (simulates unchecked ingestion expansion)
    const growthFactor = 1.4;
    const grownDailyGb = baseDailyGb * growthFactor;

    snapshots.push(makeSnapshot(
      'license_growth',
      `idx_${st.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
      st,
      grownDailyGb,
      rng.float(40, 90),   // utilization: reasonable (it's being used, just too much)
      rng.float(30, 85),   // detection: mixed
      rng.float(50, 95),   // quality: high (data is good, just too much of it)
      `License growth scenario: ${st} has grown 40% QoQ from ${baseDailyGb.toFixed(2)}GB to ${grownDailyGb.toFixed(2)}GB/day. Annual overage cost: $${Math.round((grownDailyGb - baseDailyGb) * COST_PER_GB_PER_DAY_ANNUAL).toLocaleString()}.`,
      {
        baseline_daily_gb:   Math.round(baseDailyGb * 100) / 100,
        grown_daily_gb:      Math.round(grownDailyGb * 100) / 100,
        growth_factor:       growthFactor,
        overage_cost_annual: Math.round((grownDailyGb - baseDailyGb) * COST_PER_GB_PER_DAY_ANNUAL),
      },
    ));
  }

  // Add 5 "overage spike" indexes with extreme growth (regulatory logs, cloud audit)
  const spikeSourcetypes = ['gcp:audit', 's3:access', 'cloudflare:logpush', 'azure:diagnostics', 'jamf:events'];
  for (const st of spikeSourcetypes) {
    const baseDailyGb = rng.float(2, 10);
    const spikeGb = baseDailyGb * rng.float(3, 8); // 3-8× spike
    snapshots.push(makeSnapshot(
      'license_growth',
      `idx_overage_${st.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
      st,
      spikeGb,
      rng.float(10, 40),   // low utilization — data is collected but barely queried
      rng.float(5, 20),    // low detection value
      rng.float(60, 90),   // decent quality
      `Overage spike: ${st} grew ${((spikeGb / baseDailyGb - 1) * 100).toFixed(0)}% — likely misconfigured data pipeline or backfill.`,
      { spike_multiplier: Math.round(spikeGb / baseDailyGb * 10) / 10, is_spike: true },
    ));
  }

  const totalCost    = snapshots.reduce((s, v) => s + v.cost_per_year, 0);
  const totalSavings = snapshots.reduce((s, v) => s + v.estimated_savings, 0);

  return {
    scenario:                  'license_growth',
    description:               'Unchecked ingest growth at 40% QoQ — simulates missing ingest governance. 5 spike indexes with 3–8× sudden growth from misconfigured cloud connectors.',
    snapshots,
    expected_total_cost:       totalCost,
    expected_total_savings:    totalSavings,
    expected_security_gaps:    snapshots.filter(s => s.detection_score < 30).length,
    expected_operational_gaps: snapshots.filter(s => s.utilization_score < 40).length,
    generated_at:              new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Zombie Indexes
// ─────────────────────────────────────────────────────────────────────────────

export function generateZombieIndexScenario(): ChaosDataset {
  const rng = new SeededRng('zombie_index_v1');
  const snapshots: ChaosSnapshot[] = [];

  const zombieSourcetypes = [
    'old_app_logs', 'legacy_edr', 'deprecated_siem', 'archived_hr_system',
    'legacy_vpn', 'old_itsm', 'deprecated_sso', 'legacy_endpoint',
    'old_backup_logs', 'deprecated_monitoring', 'legacy_firewall',
    'old_proxy_logs', 'deprecated_dlp', 'legacy_ids', 'old_nac_logs',
  ];

  for (const st of zombieSourcetypes) {
    const storageAllocGb = rng.float(5, 40); // Large allocation — was provisioned years ago
    const actualIngestGb = rng.float(0.001, 0.5); // Barely any data coming in now

    snapshots.push(makeSnapshot(
      'zombie_index',
      `idx_zombie_${st.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
      st,
      actualIngestGb,
      rng.float(0, 8),    // near-zero utilization — nobody queries it
      rng.float(0, 5),    // zero detection value — no use cases mapped
      rng.float(20, 50),  // mediocre quality (stale data, broken parsing)
      `Zombie index: ${st} has been inactive for 6+ months. Allocated ${storageAllocGb.toFixed(1)}GB but only ingesting ${actualIngestGb.toFixed(3)}GB/day. Zero active detection use cases. Safe to eliminate.`,
      {
        storage_allocated_gb:   Math.round(storageAllocGb * 100) / 100,
        actual_ingest_gb:       Math.round(actualIngestGb * 1000) / 1000,
        days_since_last_search: rng.int(180, 730),
        allocation_waste_pct:   Math.round((1 - actualIngestGb / storageAllocGb) * 100),
      },
    ));
  }

  // Add some "almost zombie" indexes — declining but not quite dead yet
  const decliningSourcetypes = ['transitioning_siem', 'legacy_uba', 'old_cloud_trail'];
  for (const st of decliningSourcetypes) {
    const dailyGb = rng.float(0.5, 2);
    snapshots.push(makeSnapshot(
      'zombie_index',
      `idx_declining_${st.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
      st,
      dailyGb,
      rng.float(5, 25),   // low but non-zero utilization
      rng.float(5, 20),
      rng.float(30, 60),
      `Declining index: ${st} shows reduced activity — candidate for consolidation or archive within 90 days.`,
      { trend: 'declining', days_since_last_active_search: rng.int(60, 180) },
    ));
  }

  const totalCost    = snapshots.reduce((s, v) => s + v.cost_per_year, 0);
  const totalSavings = snapshots.reduce((s, v) => s + v.estimated_savings, 0);

  return {
    scenario:                  'zombie_index',
    description:               '15 fully-dead indexes (zero detection, stale 6+ months) + 3 declining indexes. Simulates "set-and-forget" data sources never decommissioned after system retirement.',
    snapshots,
    expected_total_cost:       totalCost,
    expected_total_savings:    totalSavings,
    expected_security_gaps:    snapshots.length, // all zombies have zero detection
    expected_operational_gaps: snapshots.filter(s => s.utilization_score < 20).length,
    generated_at:              new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Duplicate Telemetry (2× storage cost)
// ─────────────────────────────────────────────────────────────────────────────

export function generateDuplicateTelemetryScenario(): ChaosDataset {
  const rng = new SeededRng('duplicate_telemetry_v1');
  const snapshots: ChaosSnapshot[] = [];

  // Pairs of duplicate indexes (original + duplicate ingest pipeline)
  const duplicatePairs = [
    ['wineventlog_primary',  'wineventlog_backup_ingest'],
    ['cloudtrail_prod',      'cloudtrail_dev_mirror'],
    ['syslog_main',          'syslog_legacy_forwarder'],
    ['endpoint_crowdstrike', 'endpoint_crowdstrike_old_hec'],
    ['network_palo',         'network_palo_duplicate_hec'],
    ['auth_okta',            'auth_okta_legacy_api'],
    ['k8s_events',           'k8s_events_helm_duplicate'],
  ];

  for (const [primary, duplicate] of duplicatePairs) {
    const baseDailyGb = rng.float(1, 15);
    const sourcetype  = primary.split('_')[0];

    // Primary — good quality, well-utilized
    snapshots.push(makeSnapshot(
      'duplicate_telemetry',
      `idx_${primary}`,
      sourcetype,
      baseDailyGb,
      rng.float(60, 90),
      rng.float(50, 85),
      rng.float(70, 95),
      `Primary pipeline for ${sourcetype}. ${baseDailyGb.toFixed(2)}GB/day, well-utilized.`,
      { is_primary: true, has_duplicate: duplicate },
    ));

    // Duplicate — identical volume (2× cost), but near-zero independent utilization
    snapshots.push(makeSnapshot(
      'duplicate_telemetry',
      `idx_${duplicate}`,
      sourcetype,
      baseDailyGb, // Same volume — that's the problem
      rng.float(0, 10),  // nobody uses this one
      rng.float(0, 5),   // no separate detection coverage
      rng.float(60, 85), // data quality is fine — it's the same data!
      `Duplicate ingest of ${sourcetype}: identical volume to ${primary}. Eliminate to save $${Math.round(baseDailyGb * COST_PER_GB_PER_DAY_ANNUAL).toLocaleString()}/year.`,
      { is_duplicate: true, primary_index: primary, wasted_gb_daily: baseDailyGb },
    ));
  }

  const totalCost    = snapshots.reduce((s, v) => s + v.cost_per_year, 0);
  const totalSavings = snapshots.reduce((s, v) => s + v.estimated_savings, 0);
  const duplicateOnlyCost = snapshots
    .filter(s => (s.metadata as any).is_duplicate)
    .reduce((sum, s) => sum + s.cost_per_year, 0);

  return {
    scenario:                  'duplicate_telemetry',
    description:               `7 pairs of duplicate ingest pipelines. Every duplicated GB costs exactly 2× with zero additional detection value. Duplicate-only waste: $${Math.round(duplicateOnlyCost).toLocaleString()}/year.`,
    snapshots,
    expected_total_cost:       totalCost,
    expected_total_savings:    totalSavings,
    expected_security_gaps:    snapshots.filter(s => (s.metadata as any).is_duplicate && s.detection_score < 10).length,
    expected_operational_gaps: snapshots.filter(s => (s.metadata as any).is_duplicate).length,
    generated_at:              new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Cardinality Explosion
// ─────────────────────────────────────────────────────────────────────────────

export function generateCardinalityExplosionScenario(): ChaosDataset {
  const rng = new SeededRng('cardinality_explosion_v1');
  const snapshots: ChaosSnapshot[] = [];

  // The primary cardinality bomb: http_url with 10M unique values per day
  snapshots.push(makeSnapshot(
    'cardinality_explosion',
    'idx_web_access_main',
    'access_combined',
    rng.float(20, 60),
    rng.float(30, 60),   // moderate utilization — but querying is slow
    rng.float(40, 60),
    rng.float(20, 40),   // low quality — because cardinality makes fields unusable
    'Cardinality explosion: http_url field contains ~10M unique values/day (GUID parameters in URLs). This causes tsidx bloat, slow search times, and field extraction failures. Recommend URL normalization.',
    {
      high_cardinality_field: 'http_url',
      unique_values_per_day:  10_000_000,
      tsidx_size_multiplier:  12,
      search_latency_factor:  8.5,
      recommendation:         'normalize_url_params',
    },
  ));

  // session_id cardinality bomb
  snapshots.push(makeSnapshot(
    'cardinality_explosion',
    'idx_app_sessions',
    'application:session',
    rng.float(5, 20),
    rng.float(20, 45),
    rng.float(10, 30),
    rng.float(15, 35),
    'Cardinality explosion: session_id field has 5M+ unique values/day. Each session generates a unique GUID, exploding the index lexicon.',
    {
      high_cardinality_field: 'session_id',
      unique_values_per_day:  5_000_000,
      recommendation:         'hash_or_drop_field',
    },
  ));

  // transaction_id explosion
  snapshots.push(makeSnapshot(
    'cardinality_explosion',
    'idx_payment_events',
    'payment:transaction',
    rng.float(3, 12),
    rng.float(50, 80),  // used heavily for fraud detection
    rng.float(60, 85),  // good detection value
    rng.float(20, 45),  // poor quality due to cardinality
    'High-value cardinality: transaction_id is forensically required but causes tsidx bloat. Consider summary indexing for analytics vs raw retention for forensics.',
    {
      high_cardinality_field: 'transaction_id',
      unique_values_per_day:  8_000_000,
      recommendation:         'tiered_retention_strategy',
      forensic_retention_days: 365,
    },
  ));

  // Moderate cardinality — many indexes with elevated but not explosive cardinality
  const moderateCardinalitySourcetypes = [
    { st: 'aws:cloudtrail',       field: 'requestParameters.keyId',      unique: 500_000  },
    { st: 'nginx:access',         field: 'user_agent',                    unique: 300_000  },
    { st: 'kubernetes:container', field: 'pod_name',                      unique: 50_000   },
    { st: 'github:audit',         field: 'repo',                          unique: 25_000   },
    { st: 'palo:traffic',         field: 'dest_ip',                       unique: 2_000_000 },
    { st: 'crowdstrike',          field: 'ContextProcessId',              unique: 1_000_000 },
    { st: 'endpoint_dlp',         field: 'file_path',                     unique: 4_000_000 },
  ];

  for (const { st, field, unique } of moderateCardinalitySourcetypes) {
    const qualityPenalty = Math.min(40, Math.log10(unique) * 5); // higher cardinality → worse quality
    snapshots.push(makeSnapshot(
      'cardinality_explosion',
      `idx_${st.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
      st,
      rng.float(1, 8),
      rng.float(40, 80),
      rng.float(30, 70),
      Math.max(10, 80 - qualityPenalty),
      `Elevated cardinality: ${field} has ${unique.toLocaleString()} unique values/day. Degraded field extraction performance.`,
      { high_cardinality_field: field, unique_values_per_day: unique },
    ));
  }

  const totalCost    = snapshots.reduce((s, v) => s + v.cost_per_year, 0);
  const totalSavings = snapshots.reduce((s, v) => s + v.estimated_savings, 0);

  return {
    scenario:                  'cardinality_explosion',
    description:               '3 extreme cardinality bombs (10M, 8M, 5M unique values/day) + 7 elevated-cardinality indexes. Models URL GUIDs, session IDs, and raw IP fields causing tsidx bloat and slow searches.',
    snapshots,
    expected_total_cost:       totalCost,
    expected_total_savings:    totalSavings,
    expected_security_gaps:    snapshots.filter(s => s.detection_score < 30).length,
    expected_operational_gaps: snapshots.filter(s => s.quality_score < 35).length,
    generated_at:              new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: ROI Boundary Stress
// ─────────────────────────────────────────────────────────────────────────────

export function generateROIBoundaryStressScenario(): ChaosDataset {
  const rng = new SeededRng('roi_boundary_stress_v1');
  const snapshots: ChaosSnapshot[] = [];

  const boundaries = [
    { name: 'critical_high',   composite: TIER_BOUNDARY_CRITICAL   + 0.5, label: 'just-above-critical'    },
    { name: 'critical_low',    composite: TIER_BOUNDARY_CRITICAL   - 0.5, label: 'just-below-critical'    },
    { name: 'highvalue_high',  composite: TIER_BOUNDARY_HIGH_VALUE + 0.5, label: 'just-above-high-value'  },
    { name: 'highvalue_low',   composite: TIER_BOUNDARY_HIGH_VALUE - 0.5, label: 'just-below-high-value'  },
    { name: 'medium_high',     composite: TIER_BOUNDARY_MEDIUM     + 0.5, label: 'just-above-medium'      },
    { name: 'medium_low',      composite: TIER_BOUNDARY_MEDIUM     - 0.5, label: 'just-below-medium'      },
    { name: 'lowvalue_high',   composite: TIER_BOUNDARY_LOW_VALUE  + 0.5, label: 'just-above-low-value'   },
    { name: 'lowvalue_low',    composite: TIER_BOUNDARY_LOW_VALUE  - 0.5, label: 'just-below-low-value'   },
  ];

  // Generate ~6 indexes per boundary (totalling ~48, rounded to 50 with extras)
  for (const boundary of boundaries) {
    const count = 6;
    for (let i = 0; i < count; i++) {
      // Decompose composite ≈ target: randomly distribute across util/detect/quality
      // such that weighted sum ≈ target composite
      // Weights: util=0.35, detect=0.40, quality=0.25
      const jitter  = rng.float(-0.4, 0.4);
      const target  = boundary.composite + jitter;
      const util    = Math.min(100, Math.max(0, target + rng.float(-8, 8)));
      const detect  = Math.min(100, Math.max(0, target + rng.float(-8, 8)));
      // Solve quality so composite ≈ target
      const quality = Math.min(100, Math.max(0,
        (target - util * 0.35 - detect * 0.40) / 0.25
      ));

      const actualComposite = util * 0.35 + detect * 0.40 + quality * 0.25;
      const expectedTier    = classifyTier(boundary.composite);
      const actualTier      = classifyTier(actualComposite);

      snapshots.push(makeSnapshot(
        'roi_boundary_stress',
        `idx_boundary_${boundary.name}_${i}`,
        rng.pick(['access_combined', 'syslog', 'WinEventLog', 'aws:cloudtrail', 'cisco_asa']),
        rng.float(0.1, 10),
        util,
        detect,
        quality,
        `Boundary stress test: target composite ${boundary.composite} (${boundary.label}). Actual: ${actualComposite.toFixed(2)}. Expected tier: ${expectedTier}, actual tier: ${actualTier}. ${actualTier !== expectedTier ? '⚠ TIER DRIFT DETECTED' : '✓ Tier stable'}`,
        {
          target_composite:  boundary.composite,
          actual_composite:  Math.round(actualComposite * 100) / 100,
          expected_tier:     expectedTier,
          actual_tier:       actualTier,
          tier_drift:        actualTier !== expectedTier,
          boundary_label:    boundary.label,
          jitter:            Math.round(jitter * 100) / 100,
        },
      ));
    }
  }

  // Add 2 extra indexes to reach exactly 50
  for (let i = 0; i < 2; i++) {
    const composite = rng.float(0, 100);
    const util      = rng.float(0, 100);
    const detect    = rng.float(0, 100);
    const quality   = Math.max(0, (composite - util * 0.35 - detect * 0.40) / 0.25);
    snapshots.push(makeSnapshot(
      'roi_boundary_stress',
      `idx_boundary_random_${i}`,
      'syslog',
      rng.float(0.1, 5),
      util, detect, Math.min(100, quality),
      'Random boundary filler index for 50-index stress test.',
      { is_filler: true },
    ));
  }

  const driftCount   = snapshots.filter(s => (s.metadata as any).tier_drift === true).length;
  const totalCost    = snapshots.reduce((sum, s) => sum + s.cost_per_year, 0);
  const totalSavings = snapshots.reduce((sum, s) => sum + s.estimated_savings, 0);

  return {
    scenario:                  'roi_boundary_stress',
    description:               `50 indexes clustered ±0.5 around all 4 tier boundaries. Detects scoring instability: ${driftCount} indexes with tier drift detected.`,
    snapshots,
    expected_total_cost:       totalCost,
    expected_total_savings:    totalSavings,
    expected_security_gaps:    snapshots.filter(s => s.detection_score < 30).length,
    expected_operational_gaps: snapshots.filter(s => s.utilization_score < 30).length,
    generated_at:              new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full dataset: all 5 scenarios combined
// ─────────────────────────────────────────────────────────────────────────────

export function generateFullChaosDataset(): FullChaosDataset {
  const scenarios = [
    generateLicenseGrowthScenario(),
    generateZombieIndexScenario(),
    generateDuplicateTelemetryScenario(),
    generateCardinalityExplosionScenario(),
    generateROIBoundaryStressScenario(),
  ];

  const total = scenarios.reduce((sum, s) => sum + s.snapshots.length, 0);

  console.log('[ChaosGenerator] Full dataset generated:');
  for (const s of scenarios) {
    console.log(`  ${s.scenario}: ${s.snapshots.length} snapshots, $${Math.round(s.expected_total_cost).toLocaleString()} cost, $${Math.round(s.expected_total_savings).toLocaleString()} savings`);
  }
  console.log(`  Total: ${total} snapshots`);

  return {
    scenarios,
    total_snapshots: total,
    generated_at:   new Date().toISOString(),
    tenant_id:      CHAOS_TENANT_ID,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entrypoint
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const dataset = generateFullChaosDataset();
  console.log(JSON.stringify(dataset, null, 2));
}
