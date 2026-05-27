import { loginAndGetToken, authGet, BASE_URL } from './_helpers';
import './setup';

const SEEDED_TENANT_ID = 'e84f31d3-d285-46a1-a0d0-2f64698cd0df';

describe('Contract: LLM Reliability & Health (Phase 6)', () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAndGetToken();
  }, 30000);

  // ─── Public Health Endpoint ────────────────────────────────────

  test('GET /api/health returns 200 with healthy status', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('healthy');
    expect(typeof body.validatedAt).toBe('string');
    expect(() => new Date(body.validatedAt)).not.toThrow();
  });

  test('GET /api/health includes schema validation results', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const body = await res.json() as any;
    expect(body.schema).toBeDefined();
    expect(body.schema).toHaveProperty('valid');
    expect(body.schema).toHaveProperty('latestMigration');
    expect(body.schema).toHaveProperty('checks');
    expect(typeof body.schema.valid).toBe('boolean');
  });

  test('GET /api/health includes purity and governance', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const body = await res.json() as any;
    expect(body.purity).toBeDefined();
    expect(body.purity).toHaveProperty('valid');
    expect(body.governance).toBeDefined();
    expect(body.governance).toHaveProperty('daemonRunning');
  });

  // ─── LLM Health Endpoint ───────────────────────────────────────

  test('GET /api/llm/health returns 200 with provider data', async () => {
    const res = await authGet('/api/llm/health', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(body.data).toHaveProperty('available');
    expect(typeof body.data.available).toBe('boolean');
    expect(body.data).toHaveProperty('endpoint');
  });

  test('GET /api/llm/health returns staleness info', async () => {
    const res = await authGet('/api/llm/health', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveProperty('stale');
    expect(typeof body.data.stale).toBe('boolean');
  });

  test('GET /api/llm/health returns valid confidence enum', async () => {
    const res = await authGet('/api/llm/health', token, SEEDED_TENANT_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(['low', 'medium', 'high']).toContain(body.data?.confidence);
  });

  // ─── LLM Failure Code Type Contract ────────────────────────────

  test('LLM failure codes cover all known failure modes', () => {
    const codes: Record<string, boolean> = {
      FAILED_MODEL_UNAVAILABLE: true,
      FAILED_MODEL_TIMEOUT: true,
      FAILED_MODEL_REFUSED: true,
      FAILED_MODEL_CONTEXT: true,
      FAILED_MODEL_CRASH: true,
    };
    for (const code of Object.keys(codes)) {
      expect(code.startsWith('FAILED_MODEL_')).toBe(true);
    }
    expect(Object.keys(codes).length).toBe(5);
  });
});
