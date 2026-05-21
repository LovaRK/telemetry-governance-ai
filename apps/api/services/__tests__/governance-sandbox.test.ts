import { Pool } from 'pg';
import { ModelGovernanceService } from '../model-governance-service';

describe('Phase 1G-B Governance Sandbox', () => {
  let pool: Pool;
  let service: ModelGovernanceService;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
    });

    // quick connectivity gate
    await pool.query('SELECT 1');
    service = new ModelGovernanceService(pool);
  });

  afterAll(async () => {
    if (service) await service.shutdown();
    if (pool) await pool.end();
  });

  test('promotion increments config_version and switches active model', async () => {
    const candidateVersion = `2026.05.int-spec.${Date.now()}`;

    const modelRes = await pool.query<{ model_id: string }>(
      `INSERT INTO approved_models (provider, model_name, model_version, status, approved_by)
       VALUES ('ollama', 'gemma2:9b', $1, 'CANDIDATE', 'integration-suite')
       RETURNING model_id`,
      [candidateVersion]
    );
    const candidateId = modelRes.rows[0].model_id;

    const before = await service.getActiveRuntime();
    const promotionId = await service.promoteModel(
      candidateId,
      '01a11111-1111-1111-1111-111111111111',
      'v1.2-spec',
      'ops-lead',
      'Integration sandbox validation'
    );
    const after = await service.getActiveRuntime();

    expect(after.modelVersion).toBe(candidateVersion);
    expect(BigInt(after.configVersion)).toBeGreaterThan(BigInt(before.configVersion));

    await service.rollbackToPromotion(promotionId, 'cleanup-operator');
    const restored = await service.getActiveRuntime();
    expect(restored.modelVersion).toBe(before.modelVersion);

    // Intentionally keep promotion lineage rows immutable for audit history.
  });

  test('rollback of bootstrap promotion is rejected', async () => {
    await expect(service.rollbackToPromotion('04d44444-4444-4444-4444-444444444444', 'test-op')).rejects.toThrow(
      'ROLLBACK_TARGET_INVALID'
    );
  });

  test('missing pointer throws NO_ACTIVE_MODEL_POINTER', async () => {
    const pointer = await pool.query<{
      tenant_id: string;
      model_id: string;
      prompt_id: string;
      current_promotion_id: string;
      decision_contract_version: string;
      config_version: string;
    }>(
      `SELECT tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version::text as config_version
       FROM active_model_pointer WHERE tenant_id='SYSTEM'`
    );

    expect(pointer.rows.length).toBe(1);
    const row = pointer.rows[0];

    await pool.query("DELETE FROM active_model_pointer WHERE tenant_id='SYSTEM'");

    try {
      await expect(service.getActiveRuntime()).rejects.toThrow('NO_ACTIVE_MODEL_POINTER');
    } finally {
      await pool.query(
        `INSERT INTO active_model_pointer
         (tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [
          row.tenant_id,
          row.model_id,
          row.prompt_id,
          row.current_promotion_id,
          row.decision_contract_version,
          Number(row.config_version),
        ]
      );
    }
  });

  test('version mismatch bypasses cache and reloads pointer context', async () => {
    const before = await service.getActiveRuntime();
    const nextContract = `v-cache-bypass-${Date.now()}`;

    await pool.query(
      `UPDATE active_model_pointer
       SET decision_contract_version = $1, config_version = config_version + 1, updated_at = NOW()
       WHERE tenant_id='SYSTEM'`,
      [nextContract]
    );

    const after = await service.getActiveRuntime();
    expect(after.contractVersion).toBe(nextContract);
    expect(BigInt(after.configVersion)).toBeGreaterThan(BigInt(before.configVersion));
  });

  test('LISTEN/NOTIFY purges cache even when config_version is unchanged', async () => {
    const before = await service.getActiveRuntime();
    const nextContract = `v-notify-${Date.now()}`;

    await pool.query(
      `UPDATE active_model_pointer
       SET decision_contract_version = $1, updated_at = NOW()
       WHERE tenant_id='SYSTEM'`,
      [nextContract]
    );
    await pool.query(`NOTIFY model_changed, 'refresh'`);

    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = await service.getActiveRuntime();

    expect(after.contractVersion).toBe(nextContract);
    expect(after.configVersion).toBe(before.configVersion);
  });

  test('listener survives shutdown + reinit and still purges cache on NOTIFY', async () => {
    const before = await service.getActiveRuntime();
    await service.shutdown();

    // Reinitialize listener through a fresh service instance.
    service = new ModelGovernanceService(pool);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const nextContract = `v-notify-reconnect-${Date.now()}`;
    await pool.query(
      `UPDATE active_model_pointer
       SET decision_contract_version = $1, updated_at = NOW()
       WHERE tenant_id='SYSTEM'`,
      [nextContract]
    );
    await pool.query(`NOTIFY model_changed, 'refresh'`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const after = await service.getActiveRuntime();
    expect(after.contractVersion).toBe(nextContract);
    expect(after.configVersion).toBe(before.configVersion);
  });
});
