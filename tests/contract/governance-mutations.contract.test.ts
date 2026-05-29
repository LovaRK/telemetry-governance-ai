import { query } from '../../core/database/connection';
import { loginAndGetToken, authPost, authGet } from './_helpers';
import './setup';

const SEEDED_TENANT_ID = process.env.TEST_TENANT_ID || '6a917e40-329c-4702-ac27-c3af8978365a';

describe('Contract: Governance Mutations (Phase 7)', () => {
  let token: string;
  let testIndexName: string;

  beforeAll(async () => {
    token = await loginAndGetToken();

    // Pick an existing index from agent_decisions to test against
    const idx = await query<{ index_name: string }>(
      `SELECT index_name FROM agent_decisions WHERE tenant_id = $1 LIMIT 1`,
      [SEEDED_TENANT_ID]
    );
    expect(idx.rows.length).toBeGreaterThan(0);
    testIndexName = idx.rows[0]!.index_name;
  }, 30000);

  // ─── POST Mutations ────────────────────────────────────────────

  test('POST /api/governance/mutations APPROVE returns ok=true', async () => {
    const res = await authPost('/api/governance/mutations', token, {
      indexName: testIndexName,
      mutationType: 'APPROVE',
      actorEmail: 'test@bitsio.com',
      idempotencyKey: `test-approve-${Date.now()}`,
    }, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.ok).toBe(true);
    expect(body.data.id).toBeDefined();
  });

  test('POST /api/governance/mutations REJECT returns ok=true', async () => {
    const res = await authPost('/api/governance/mutations', token, {
      indexName: testIndexName,
      mutationType: 'REJECT',
      actorEmail: 'test@bitsio.com',
      actionNote: 'Testing rejection flow',
    }, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.ok).toBe(true);
  });

  test('POST validates required fields (indexName missing → 500)', async () => {
    const res = await authPost('/api/governance/mutations', token, {
      mutationType: 'APPROVE',
    }, SEEDED_TENANT_ID);
    expect(res.status).toBe(500);
  });

  test('POST validates required fields (mutationType missing → 500)', async () => {
    const res = await authPost('/api/governance/mutations', token, {
      indexName: testIndexName,
    }, SEEDED_TENANT_ID);
    expect(res.status).toBe(500);
  });

  test('POST supports idempotency — same key returns same id', async () => {
    const key = `test-idempotent-${Date.now()}`;
    const res1 = await authPost('/api/governance/mutations', token, {
      indexName: testIndexName,
      mutationType: 'APPROVE',
      actorEmail: 'test@bitsio.com',
      idempotencyKey: key,
    }, SEEDED_TENANT_ID);
    const body1 = await res1.json() as any;

    const res2 = await authPost('/api/governance/mutations', token, {
      indexName: testIndexName,
      mutationType: 'APPROVE',
      actorEmail: 'test@bitsio.com',
      idempotencyKey: key,
    }, SEEDED_TENANT_ID);
    const body2 = await res2.json() as any;

    expect(body1.data.id).toBe(body2.data.id);
  });

  // ─── GET Mutations ─────────────────────────────────────────────

  test('GET /api/governance/mutations returns mutation list', async () => {
    const res = await authGet('/api/governance/mutations', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(body.data.mutations).toBeDefined();
    expect(Array.isArray(body.data.mutations)).toBe(true);
    expect(body.data.summary).toBeDefined();
    expect(body.data.summary).toHaveProperty('total');
  });

  test('GET /api/governance/mutations returns proper shape per mutation', async () => {
    const res = await authGet('/api/governance/mutations', token, SEEDED_TENANT_ID);
    const body = await res.json() as any;
    const mutations = body.data.mutations;
    if (mutations.length > 0) {
      const m = mutations[0];
      expect(m).toHaveProperty('id');
      expect(m).toHaveProperty('indexName');
      expect(m).toHaveProperty('mutationType');
      expect(m).toHaveProperty('recordedAt');
    }
  });
});
