import { authGet, authPost, loginAndGetToken } from './_helpers';

describe('Contract: explainability + validation agent APIs', () => {
  test('GET /api/executive-summary/explain returns stable explainability shape', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/executive-summary/explain', token);

    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as any;

    if (res.status === 503) {
      expect(body.error).toMatch(/NO_ACTIVE_MODEL_POINTER|No published run/i);
      return;
    }

    expect(Array.isArray(body.data)).toBe(true);

    for (const row of body.data as any[]) {
      expect(typeof row.metricId).toBe('string');
      expect(typeof row.formulaId).toBe('string');
      expect(typeof row.formulaExpression).toBe('string');
      expect(Array.isArray(row.inputs)).toBe(true);
      expect(typeof row.sourceTable).toBe('string');
      expect(typeof row.sourceRunId).toBe('string');
      expect(typeof row.sourceSnapshotId).toBe('string');
      expect(typeof row.updatedAt).toBe('string');
      expect(['high', 'medium', 'low']).toContain(String(row.confidence).toLowerCase());

      const value = Number(row.value);
      const computed = Number(row.computedValue);
      expect(Number.isFinite(value)).toBe(true);
      expect(Number.isFinite(computed)).toBe(true);
      expect(Math.abs(value - computed)).toBeLessThanOrEqual(0.01);
    }
  });

  test('GET /api/kpi/:id/trace resolves known ids and 404s for missing ids', async () => {
    const token = await loginAndGetToken();
    const explainRes = await authGet('/api/executive-summary/explain', token);
    if (explainRes.status !== 200) {
      expect([503]).toContain(explainRes.status);
      return;
    }

    const explainBody = (await explainRes.json()) as any;
    const first = explainBody.data?.[0];
    if (!first) {
      return;
    }

    const okRes = await authGet(`/api/kpi/${encodeURIComponent(first.metricId)}/trace`, token);
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as any;
    expect(okBody.data.metricId).toBe(first.metricId);

    const missingRes = await authGet('/api/kpi/nonexistent_metric/trace', token);
    expect(missingRes.status).toBe(404);
  });

  test('dashboard validation run + latest + runId endpoints persist consistent shape', async () => {
    const token = await loginAndGetToken();

    const runRes = await authPost('/api/dashboard-validation/run', token, { forceMismatch: true });
    expect([200, 503]).toContain(runRes.status);

    if (runRes.status === 503) {
      const errBody = (await runRes.json()) as any;
      expect(errBody.error).toMatch(/NO_ACTIVE_MODEL_POINTER|No published run/i);
      return;
    }

    const runBody = (await runRes.json()) as any;
    expect(typeof runBody).toBe("object");
    expect(typeof runBody.data.runId).toBe('string');
    expect(typeof runBody.data.status).toBe('string');

    const latestRes = await authGet('/api/dashboard-validation/latest', token);
    expect(latestRes.status).toBe(200);
    const latestBody = (await latestRes.json()) as any;
    expect(typeof latestBody).toBe("object");
    expect(latestBody.data.runId).toBe(runBody.data.runId);

    const byIdRes = await authGet(`/api/dashboard-validation/${encodeURIComponent(runBody.data.runId)}`, token);
    expect(byIdRes.status).toBe(200);
    const byIdBody = (await byIdRes.json()) as any;
    expect(typeof byIdBody).toBe("object");
    expect(byIdBody.data.runId).toBe(runBody.data.runId);
    expect(Array.isArray(byIdBody.data.failures)).toBe(true);

    if (String(runBody.data.status).toLowerCase() === 'failed') {
      expect(byIdBody.data.failures.length).toBeGreaterThan(0);
    }
  });
});
