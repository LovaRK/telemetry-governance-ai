import { Pool } from 'pg';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002';

describe('Contract: /api/llm/governance/active', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
    });
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('pointer exists -> 200 runtime metadata; pointer removed -> 503; config bump reflected', async () => {
    const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
    if (!health?.ok) {
      console.warn(`Skipping: API not reachable at ${BASE_URL}`);
      return;
    }

    const token = await tryLoginToken();
    if (!token) {
      console.warn('Skipping: login unavailable for contract run');
      return;
    }

    const okRes = await fetch(`${BASE_URL}/api/llm/governance/active`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(okRes.status).toBe(200);
    const okBody: any = await okRes.json();
    expect(okBody?.data?.runtime?.modelId).toBeTruthy();
    expect(okBody?.data?.runtime?.modelName).toBeTruthy();
    expect(okBody?.data?.runtime?.modelVersion).toBeTruthy();
    expect(okBody?.data?.runtime?.promptVersion).toBeTruthy();
    expect(okBody?.data?.runtime?.contractVersion).toBeTruthy();
    expect(okBody?.data?.runtime?.configVersion).toBeTruthy();
    expect(okBody?.data?.cache?.listenerConnected).toBeDefined();
    expect(okBody?.data?.cache?.cacheLoaded).toBeDefined();
    expect(okBody?.data?.runtime?.systemPromptHash).toBeUndefined();
    expect(okBody?.data?.runtime?.promptHash).toBeUndefined();
    expect(okBody?.data?.runtime?.encryptedPrompt).toBeUndefined();
    expect(okBody?.data?.promotion?.runtimeSnapshot).toBeUndefined();

    const pointerRows = await pool.query<{
      tenant_id: string;
      model_id: string;
      prompt_id: string;
      current_promotion_id: string;
      decision_contract_version: string;
      config_version: string;
    }>(
      `SELECT tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version::text as config_version
       FROM active_model_pointer
       WHERE tenant_id='SYSTEM'`
    );
    expect(pointerRows.rows.length).toBe(1);
    const p = pointerRows.rows[0];

    const beforeVersion = BigInt(okBody?.data?.runtime?.configVersion || '0');

    try {
      await pool.query(`DELETE FROM active_model_pointer WHERE tenant_id='SYSTEM'`);
      const missingRes = await fetch(`${BASE_URL}/api/llm/governance/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(missingRes.status).toBe(503);
      const missingBody: any = await missingRes.json();
      expect(missingBody?.error).toBe('NO_ACTIVE_MODEL_POINTER');
    } finally {
      await pool.query(
        `INSERT INTO active_model_pointer
         (tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (tenant_id, snapshot_source) DO UPDATE SET
           model_id = EXCLUDED.model_id,
           prompt_id = EXCLUDED.prompt_id,
           current_promotion_id = EXCLUDED.current_promotion_id,
           decision_contract_version = EXCLUDED.decision_contract_version,
           config_version = EXCLUDED.config_version,
           updated_at = NOW()`,
        [p.tenant_id, p.model_id, p.prompt_id, p.current_promotion_id, p.decision_contract_version, Number(p.config_version)]
      );
    }

    await pool.query(
      `UPDATE active_model_pointer
       SET config_version = config_version + 1, updated_at = NOW()
       WHERE tenant_id='SYSTEM'`
    );
    await pool.query(`NOTIFY model_changed, 'refresh'`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const refreshedRes = await fetch(`${BASE_URL}/api/llm/governance/active`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(refreshedRes.status).toBe(200);
    const refreshedBody: any = await refreshedRes.json();
    const afterVersion = BigInt(refreshedBody?.data?.runtime?.configVersion || '0');
    expect(afterVersion).toBeGreaterThan(beforeVersion);
  });
});

async function tryLoginToken(): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@bitso.com', password: 'Admin@12345' }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const body: any = await res.json().catch(() => null);
  return body?.data?.accessToken || null;
}
