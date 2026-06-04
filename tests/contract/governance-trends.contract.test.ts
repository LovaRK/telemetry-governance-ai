/**
 * Contract: governance trend engine (Stage 3B)
 *
 * Test 1 — Two snapshots with known ROI values
 *   Snapshot A: ROI = 25
 *   Snapshot B: ROI = 30
 *   Expected: delta = +5, pct = +20%, direction = 'up'
 *
 * Test 2 — Single snapshot
 *   Expected: sufficient_history = false, no delta computed
 *
 * Test 3 — Tenant A and Tenant B snapshots
 *   Expected: no cross-tenant trend contamination
 */

import { randomUUID } from 'crypto';
import { query } from '../../core/database/connection';
import { loginAndGetToken, authGet } from './_helpers';
import './setup';

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedTenant(name: string): Promise<string> {
  const id = randomUUID();
  const slug = `${name.toLowerCase().replace(/\W+/g, '-')}-${id.slice(0, 8)}`;
  await query(
    `INSERT INTO tenants (id, name, slug, is_configured)
     VALUES ($1, $2, $3, true) ON CONFLICT (id) DO NOTHING`,
    [id, name, slug]
  );
  return id;
}

async function seedKpiSnapshot(params: {
  tenantId:        string;
  publishedAt:     string;   // ISO — controls ORDER BY published_at
  roiScore:        number;
  gainscopeScore:  number;
  totalLicenseSpend: number;
  licenseSpendLowValue: number;
  totalDailyGb:    number;
  totalSourcetypes:number;
  avgUtilization:  number;
  avgDetection:    number;
  avgQuality:      number;
  tierCritical:    number;
  tierImportant:   number;
  tierNiceToHave:  number;
  tierLowValue:    number;
}): Promise<{ runId: string; snapshotId: string }> {
  const runId      = randomUUID();
  const snapshotId = randomUUID();
  const idem       = `trend-test-${runId}`.padEnd(64, '0').slice(0, 64);
  // source_hash intentionally NOT the splunk_live sentinel, so trends API includes it
  const srcHash    = `csv-analytics-${runId}`.padEnd(64, '0').slice(0, 64);

  await query(
    `INSERT INTO pipeline_runs
       (run_id, snapshot_id, tenant_id, status, published, published_at, started_at,
        pipeline_version, model_version, prompt_version, splunk_query_version, model_name,
        source_hash, snapshot_hash, idempotency_hash)
     VALUES ($1,$2,$3,'SUCCEEDED',true,$4::timestamptz,$4::timestamptz,
             '2.0','csv','1.0','1.0','test-model',$5,$6,$7)`,
    [runId, snapshotId, params.tenantId, params.publishedAt, srcHash,
     `snap-${snapshotId}`.padEnd(64, '0').slice(0, 64), idem]
  );

  await query(
    `INSERT INTO executive_kpis (
       snapshot_id, snapshot_date, tenant_id,
       roi_score, gainscope_score,
       total_license_spend, license_spend_low_value, storage_savings_potential,
       total_daily_gb, total_sourcetypes,
       tier_critical, tier_important, tier_nice_to_have, tier_low_value,
       security_gaps, operational_gaps,
       avg_utilization, avg_detection, avg_quality, avg_confidence,
       quick_wins, savings_staircase, agent_reasoning,
       tier_1_spend_annual, tier_2_spend_annual, tier_3_spend_annual, tier_4_spend_annual
     ) VALUES (
       $1, NOW()::date, $2,
       $3,$4,$5,$6,$5,$7,$8,
       $9,$10,$11,$12,0,0,$13,$14,$15,90,
       '[]'::jsonb,'[]'::jsonb,'test',0,0,0,0
     ) ON CONFLICT DO NOTHING`,
    [snapshotId, params.tenantId,
     params.roiScore, params.gainscopeScore,
     params.totalLicenseSpend, params.licenseSpendLowValue,
     params.totalDailyGb, params.totalSourcetypes,
     params.tierCritical, params.tierImportant, params.tierNiceToHave, params.tierLowValue,
     params.avgUtilization, params.avgDetection, params.avgQuality]
  );

  return { runId, snapshotId };
}

async function cleanTenant(tenantId: string): Promise<void> {
  await query(`DELETE FROM executive_kpis   WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM pipeline_runs    WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM tenants          WHERE id        = $1`, [tenantId]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Contract: governance trend engine (Stage 3B)', () => {
  let token: string;

  beforeAll(async () => { token = await loginAndGetToken(); }, 15000);

  // ── Test 1: two snapshots, known ROI values → delta = +5, +20% ────────────

  describe('Test 1 — ROI 25 → 30: delta +5, +20%', () => {
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await seedTenant('Trend Test 1 Tenant');

      // Seed OLDER snapshot (previous): ROI = 25
      await seedKpiSnapshot({
        tenantId, publishedAt: '2026-05-01T00:00:00Z',
        roiScore: 25, gainscopeScore: 5, totalLicenseSpend: 500000,
        licenseSpendLowValue: 450000, totalDailyGb: 150, totalSourcetypes: 160,
        avgUtilization: 4, avgDetection: 0, avgQuality: 90,
        tierCritical: 0, tierImportant: 2, tierNiceToHave: 140, tierLowValue: 18,
      });

      // Seed NEWER snapshot (current): ROI = 30
      await seedKpiSnapshot({
        tenantId, publishedAt: '2026-06-01T00:00:00Z',
        roiScore: 30, gainscopeScore: 6, totalLicenseSpend: 480000,
        licenseSpendLowValue: 420000, totalDailyGb: 155, totalSourcetypes: 165,
        avgUtilization: 5, avgDetection: 0, avgQuality: 92,
        tierCritical: 1, tierImportant: 3, tierNiceToHave: 145, tierLowValue: 16,
      });
    }, 20000);

    afterAll(() => cleanTenant(tenantId));

    test('sufficient_history = true when 2 snapshots exist', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.sufficient_history).toBe(true);
    });

    test('current.roiScore = 30, previous.roiScore = 25', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      const body = await res.json() as any;
      expect(body.data.current.roiScore).toBe(30);
      expect(body.data.previous.roiScore).toBe(25);
    });

    test('delta.roiScore: absolute = +5, pct = +20%, direction = up', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      const body = await res.json() as any;
      const d = body.data.deltas.roiScore;
      expect(d.absolute).toBe(5);
      expect(d.pct).toBe(20);
      expect(d.direction).toBe('up');
    });

    test('delta.totalLicenseSpend is negative (spend decreased)', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      const body = await res.json() as any;
      const d = body.data.deltas.totalLicenseSpend;
      // 480000 - 500000 = -20000
      expect(d.absolute).toBe(-20000);
      expect(d.direction).toBe('down');
    });

    test('deltas object contains all 13 tracked metrics', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      const body = await res.json() as any;
      const keys = Object.keys(body.data.deltas);
      const expected = [
        'roiScore','gainscopeScore','totalLicenseSpend','licenseSpendLowValue',
        'totalDailyGb','totalSourcetypes','avgUtilization','avgDetection','avgQuality',
        'tierCritical','tierImportant','tierNiceToHave','tierLowValue',
      ];
      expected.forEach(k => expect(keys).toContain(k));
      expect(keys).toHaveLength(expected.length);
    });
  });

  // ── Test 2: single snapshot → insufficient_history ────────────────────────

  describe('Test 2 — Single snapshot → insufficient history', () => {
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await seedTenant('Trend Test 2 Tenant');
      await seedKpiSnapshot({
        tenantId, publishedAt: '2026-06-01T00:00:00Z',
        roiScore: 25, gainscopeScore: 5, totalLicenseSpend: 500000,
        licenseSpendLowValue: 450000, totalDailyGb: 150, totalSourcetypes: 160,
        avgUtilization: 4, avgDetection: 0, avgQuality: 90,
        tierCritical: 0, tierImportant: 2, tierNiceToHave: 140, tierLowValue: 18,
      });
    }, 15000);

    afterAll(() => cleanTenant(tenantId));

    test('sufficient_history = false', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.sufficient_history).toBe(false);
    });

    test('deltas is null when only one snapshot', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      const body = await res.json() as any;
      expect(body.data.deltas).toBeNull();
    });

    test('current is populated, previous is null', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      const body = await res.json() as any;
      expect(body.data.current).not.toBeNull();
      expect(body.data.current.roiScore).toBe(25);
      expect(body.data.previous).toBeNull();
    });

    test('response includes a human-readable message', async () => {
      const res = await authGet('/api/governance/trends', token, tenantId, 'test-user');
      const body = await res.json() as any;
      expect(body.data.message).toBeTruthy();
      expect(body.data.message.toLowerCase()).toContain('insufficient');
    });
  });

  // ── Test 3: cross-tenant isolation ────────────────────────────────────────

  describe('Test 3 — Cross-tenant trend isolation', () => {
    let tenantA: string;
    let tenantB: string;

    beforeAll(async () => {
      tenantA = await seedTenant('Trend Tenant A');
      tenantB = await seedTenant('Trend Tenant B');

      // Tenant A: 2 snapshots (ROI 20 → 40)
      await seedKpiSnapshot({
        tenantId: tenantA, publishedAt: '2026-05-01T00:00:00Z',
        roiScore: 20, gainscopeScore: 3, totalLicenseSpend: 600000,
        licenseSpendLowValue: 560000, totalDailyGb: 200, totalSourcetypes: 180,
        avgUtilization: 3, avgDetection: 0, avgQuality: 88,
        tierCritical: 0, tierImportant: 1, tierNiceToHave: 150, tierLowValue: 29,
      });
      await seedKpiSnapshot({
        tenantId: tenantA, publishedAt: '2026-06-01T00:00:00Z',
        roiScore: 40, gainscopeScore: 8, totalLicenseSpend: 550000,
        licenseSpendLowValue: 500000, totalDailyGb: 190, totalSourcetypes: 180,
        avgUtilization: 7, avgDetection: 0, avgQuality: 91,
        tierCritical: 2, tierImportant: 4, tierNiceToHave: 150, tierLowValue: 24,
      });

      // Tenant B: 2 snapshots (ROI 60 → 70)
      await seedKpiSnapshot({
        tenantId: tenantB, publishedAt: '2026-05-01T00:00:00Z',
        roiScore: 60, gainscopeScore: 20, totalLicenseSpend: 200000,
        licenseSpendLowValue: 100000, totalDailyGb: 50, totalSourcetypes: 80,
        avgUtilization: 25, avgDetection: 30, avgQuality: 95,
        tierCritical: 10, tierImportant: 20, tierNiceToHave: 40, tierLowValue: 10,
      });
      await seedKpiSnapshot({
        tenantId: tenantB, publishedAt: '2026-06-01T00:00:00Z',
        roiScore: 70, gainscopeScore: 25, totalLicenseSpend: 180000,
        licenseSpendLowValue: 80000, totalDailyGb: 45, totalSourcetypes: 80,
        avgUtilization: 30, avgDetection: 35, avgQuality: 97,
        tierCritical: 12, tierImportant: 22, tierNiceToHave: 38, tierLowValue: 8,
      });
    }, 20000);

    afterAll(async () => {
      await cleanTenant(tenantA);
      await cleanTenant(tenantB);
    });

    test('Tenant A trends use only Tenant A snapshots', async () => {
      const res = await authGet('/api/governance/trends', token, tenantA, 'test-user');
      const body = await res.json() as any;
      expect(body.data.sufficient_history).toBe(true);
      expect(body.data.current.roiScore).toBe(40);   // Tenant A's latest
      expect(body.data.previous.roiScore).toBe(20);  // Tenant A's prior
      expect(body.data.deltas.roiScore.absolute).toBe(20);
    });

    test('Tenant B trends use only Tenant B snapshots', async () => {
      const res = await authGet('/api/governance/trends', token, tenantB, 'test-user');
      const body = await res.json() as any;
      expect(body.data.sufficient_history).toBe(true);
      expect(body.data.current.roiScore).toBe(70);   // Tenant B's latest
      expect(body.data.previous.roiScore).toBe(60);  // Tenant B's prior
      expect(body.data.deltas.roiScore.absolute).toBe(10);
    });

    test('Tenant A ROI does not contaminate Tenant B trends', async () => {
      const resB = await authGet('/api/governance/trends', token, tenantB, 'test-user');
      const bodyB = await resB.json() as any;
      // Tenant A ROI values (20 and 40) must not appear in Tenant B response
      expect(bodyB.data.current.roiScore).not.toBe(40);
      expect(bodyB.data.previous.roiScore).not.toBe(20);
    });

    test('meta.tenantId matches the authenticated tenant', async () => {
      const resA = await authGet('/api/governance/trends', token, tenantA, 'test-user');
      const bodyA = await resA.json() as any;
      expect(bodyA.meta.tenantId).toBe(tenantA);
    });
  });
});
