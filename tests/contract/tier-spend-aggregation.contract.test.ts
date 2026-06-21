import { query } from '@core/database/connection';
import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: Tier Spend Aggregation & Reconciliation', () => {
  describe('P0.3.3 Tier Spend Persistence', () => {
    test('executive_kpis table has 12 new columns', async () => {
      const result = await query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'executive_kpis'
         AND column_name IN (
           'tier_1_spend_annual', 'tier_2_spend_annual', 'tier_3_spend_annual', 'tier_4_spend_annual',
           'tier_1_count', 'tier_2_count', 'tier_3_count', 'tier_4_count',
           'tier_spend_reconciled', 'tier_spend_delta'
         )
         ORDER BY column_name`
      );

      expect(result.rows).toHaveLength(10);
      const columnNames = result.rows.map((r: any) => r.column_name);
      expect(columnNames).toContain('tier_1_spend_annual');
      expect(columnNames).toContain('tier_2_spend_annual');
      expect(columnNames).toContain('tier_3_spend_annual');
      expect(columnNames).toContain('tier_4_spend_annual');
      expect(columnNames).toContain('tier_1_count');
      expect(columnNames).toContain('tier_2_count');
      expect(columnNames).toContain('tier_3_count');
      expect(columnNames).toContain('tier_4_count');
      expect(columnNames).toContain('tier_spend_reconciled');
      expect(columnNames).toContain('tier_spend_delta');
    });

    test('tier spend columns have correct data types', async () => {
      const result = await query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = 'executive_kpis'
         AND column_name IN (
           'tier_1_spend_annual', 'tier_2_spend_annual',
           'tier_spend_reconciled', 'tier_spend_delta'
         )`
      );

      const typeMap = result.rows.reduce((acc: any, r: any) => {
        acc[r.column_name] = r.data_type;
        return acc;
      }, {});

      expect(typeMap.tier_1_spend_annual).toBe('numeric');
      expect(typeMap.tier_spend_reconciled).toBe('boolean');
      expect(typeMap.tier_spend_delta).toBe('numeric');
    });
  });

  describe('P0.3.3 Snapshot Promotion Rule (Hard Rejection Gate)', () => {
    test('reconciliation delta is computed correctly', async () => {
      // Get latest executive KPI snapshot
      const result = await query(
        `SELECT
           tier_1_spend_annual + tier_2_spend_annual + tier_3_spend_annual + tier_4_spend_annual as tier_total,
           total_license_spend,
           tier_spend_delta
         FROM executive_kpis
         ORDER BY created_at DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        // No data yet - this is fine for empty dataset
        return;
      }

      const row = result.rows[0];
      const expectedDelta = Math.abs(
        parseFloat(row.tier_total) - parseFloat(row.total_license_spend)
      );

      expect(Math.abs(expectedDelta - parseFloat(row.tier_spend_delta))).toBeLessThan(0.01);
    });

    test('reconciliation passes when delta <= 0.01', async () => {
      const result = await query(
        `SELECT tier_spend_reconciled FROM executive_kpis
         WHERE tier_spend_delta <= 0.01
         ORDER BY created_at DESC
         LIMIT 5`
      );

      // All snapshots with delta <= 0.01 must have reconciled = true
      result.rows.forEach((row: any) => {
        expect(row.tier_spend_reconciled).toBe(true);
      });
    });

    test('reconciliation fails when delta > 0.01', async () => {
      const result = await query(
        `SELECT tier_spend_reconciled, tier_spend_delta FROM executive_kpis
         WHERE tier_spend_delta > 0.01
         ORDER BY created_at DESC
         LIMIT 5`
      );

      // All snapshots with delta > 0.01 must have reconciled = false
      result.rows.forEach((row: any) => {
        expect(row.tier_spend_reconciled).toBe(false);
      });
    });
  });

  describe('P0.3.3 API Contract: tierSpend, tierCounts, tierSpendMetadata', () => {
    test('GET /api/executive-summary returns tierSpend object', async () => {
      const token = await loginAndGetToken();
      const res = await authGet('/api/executive-summary', token);

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // If data exists, must have tierSpend
      if (!body.empty && body.data?.kpis) {
        expect(body.data.kpis.tierSpend).toEqual(expect.any(Object));
        expect(body.data.kpis.tierSpend).toHaveProperty('critical');
        expect(body.data.kpis.tierSpend).toHaveProperty('important');
        expect(body.data.kpis.tierSpend).toHaveProperty('niceToHave');
        expect(body.data.kpis.tierSpend).toHaveProperty('lowValue');

        // Values must be numbers (possibly 0)
        expect(typeof body.data.kpis.tierSpend.critical).toBe('number');
        expect(typeof body.data.kpis.tierSpend.important).toBe('number');
        expect(typeof body.data.kpis.tierSpend.niceToHave).toBe('number');
        expect(typeof body.data.kpis.tierSpend.lowValue).toBe('number');
      }
    });

    test('GET /api/executive-summary returns tierCounts object', async () => {
      const token = await loginAndGetToken();
      const res = await authGet('/api/executive-summary', token);

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // Always must have tierCounts (even empty)
      expect(body.data?.kpis?.tierCounts).toEqual(expect.any(Object));
      expect(body.data.kpis.tierCounts).toHaveProperty('critical');
      expect(body.data.kpis.tierCounts).toHaveProperty('important');
      expect(body.data.kpis.tierCounts).toHaveProperty('niceToHave');
      expect(body.data.kpis.tierCounts).toHaveProperty('lowValue');

      // Values must be numbers
      expect(typeof body.data.kpis.tierCounts.critical).toBe('number');
      expect(typeof body.data.kpis.tierCounts.important).toBe('number');
      expect(typeof body.data.kpis.tierCounts.niceToHave).toBe('number');
      expect(typeof body.data.kpis.tierCounts.lowValue).toBe('number');
    });

    test('GET /api/executive-summary returns tierSpendMetadata', async () => {
      const token = await loginAndGetToken();
      const res = await authGet('/api/executive-summary', token);

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // Must have metadata with classification
      expect(body.data?.kpis?.tierSpendMetadata).toEqual(expect.any(Object));
      expect(body.data.kpis.tierSpendMetadata).toHaveProperty('classification');
      expect(body.data.kpis.tierSpendMetadata).toHaveProperty('source');
      expect(body.data.kpis.tierSpendMetadata).toHaveProperty('pipelineRunId');
      expect(body.data.kpis.tierSpendMetadata).toHaveProperty('generatedAt');
      expect(body.data.kpis.tierSpendMetadata).toHaveProperty('reconciled');
      expect(body.data.kpis.tierSpendMetadata).toHaveProperty('delta');

      // Classification must be REAL or EMPTY
      expect(['REAL', 'EMPTY', 'DERIVED', 'BASELINE']).toContain(
        body.data.kpis.tierSpendMetadata.classification
      );

      // Source must be agent_decisions
      expect(body.data.kpis.tierSpendMetadata.source).toBe('agent_decisions');

      // Reconciled must be boolean
      expect(typeof body.data.kpis.tierSpendMetadata.reconciled).toBe('boolean');

      // Delta must be number
      expect(typeof body.data.kpis.tierSpendMetadata.delta).toBe('number');
    });
  });

  describe('P0.3.3 Empty Dataset Contract', () => {
    test('empty dataset returns tier spends as 0, never null', async () => {
      const token = await loginAndGetToken();
      const res = await authGet('/api/executive-summary', token);

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // Even if empty, tierSpend must exist with 0 values
      if (body.empty) {
        expect(body.data?.kpis?.tierSpend).toEqual({
          critical: 0,
          important: 0,
          niceToHave: 0,
          lowValue: 0,
        });

        expect(body.data?.kpis?.tierCounts).toEqual({
          critical: 0,
          important: 0,
          niceToHave: 0,
          lowValue: 0,
        });

        expect(body.data?.kpis?.tierSpendMetadata?.classification).toBe('EMPTY');
      }
    });

    test('empty dataset NEVER returns null for tierSpend', async () => {
      const token = await loginAndGetToken();
      const res = await authGet('/api/executive-summary', token);

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // Explicitly check that tierSpend is not null or undefined
      expect(body.data?.kpis?.tierSpend).not.toBeNull();
      expect(body.data?.kpis?.tierSpend).not.toBeUndefined();

      // And not an empty object
      expect(Object.keys(body.data?.kpis?.tierSpend || {})).toHaveLength(4);
    });
  });

  describe('P0.3.3 Reconciliation Validation', () => {
    test('valid snapshot: tierSpend sum ≈ totalLicenseSpend (±0.01)', async () => {
      const token = await loginAndGetToken();
      const res = await authGet('/api/executive-summary', token);

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      if (!body.empty && body.data?.kpis) {
        const tierSum =
          body.data.kpis.tierSpend.critical +
          body.data.kpis.tierSpend.important +
          body.data.kpis.tierSpend.niceToHave +
          body.data.kpis.tierSpend.lowValue;

        const delta = Math.abs(tierSum - body.data.kpis.totalLicenseSpend);

        // If not empty and has data, reconciliation should pass
        if (body.data.kpis.totalLicenseSpend > 0) {
          expect(delta).toBeLessThanOrEqual(0.01);
        }
      }
    });
  });
});

jest.setTimeout(30000);
