import { Pool, PoolClient } from 'pg';

export interface RuntimeFingerprint {
  modelId: string;
  promptId: string;
  promotionId: string;
  provider: string;
  modelName: string;
  modelVersion: string;
  contractVersion: string;
  promptVersion: string;
  systemPromptHash: string;
  configVersion: string;
}

export class ModelGovernanceService {
  private pool: Pool;
  private cachedConfig: RuntimeFingerprint | null = null;
  private cacheExpiresAt = 0;
  private localCachedVersion = '0';
  private listenerClient: PoolClient | null = null;
  private isListening = false;
  private readonly cacheTtlMs = 60_000;

  constructor(pgPool: Pool) {
    this.pool = pgPool;
    this.initNotificationBus().catch((err) => {
      console.error('[ModelGovernanceService] failed to initialize notification bus', err);
    });
  }

  private async initNotificationBus(): Promise<void> {
    if (this.isListening) return;

    try {
      this.listenerClient = await this.pool.connect();
      await this.listenerClient.query('LISTEN model_changed');

      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === 'model_changed') {
          this.purgeLocalCache();
        }
      });

      this.listenerClient.on('error', (err) => {
        console.error('[ModelGovernanceService] listener connection dropped', err);
        this.cleanupListener();
        setTimeout(() => {
          this.initNotificationBus().catch((e) => {
            console.error('[ModelGovernanceService] listener reconnect failed', e);
          });
        }, 5000);
      });

      this.isListening = true;
    } catch (err) {
      this.cleanupListener();
      throw err;
    }
  }

  private purgeLocalCache(): void {
    this.cachedConfig = null;
    this.cacheExpiresAt = 0;
    this.localCachedVersion = '0';
  }

  private cleanupListener(): void {
    this.isListening = false;
    if (this.listenerClient) {
      this.listenerClient.release(true);
      this.listenerClient = null;
    }
  }

  public async getActiveRuntime(): Promise<RuntimeFingerprint> {
    const now = Date.now();

    try {
      const versionCheck = await this.pool.query<{ version: string }>(
        "SELECT config_version::text as version FROM active_model_pointer WHERE tenant_id = 'SYSTEM'"
      );

      if (versionCheck.rows.length === 0) {
        throw new Error('NO_ACTIVE_MODEL_POINTER');
      }

      const dbVersion = versionCheck.rows[0].version;

      if (this.cachedConfig && now < this.cacheExpiresAt && this.localCachedVersion === dbVersion) {
        return this.cachedConfig;
      }

      const result = await this.pool.query<RuntimeFingerprint>(`
        SELECT
          amp.model_id as "modelId",
          amp.prompt_id as "promptId",
          amp.current_promotion_id as "promotionId",
          amp.decision_contract_version as "contractVersion",
          amp.config_version::text as "configVersion",
          am.provider,
          am.model_name as "modelName",
          am.model_version as "modelVersion",
          pr.version as "promptVersion",
          pr.system_prompt_hash as "systemPromptHash"
        FROM active_model_pointer amp
        JOIN approved_models am ON amp.model_id = am.model_id
        JOIN prompt_registry pr ON amp.prompt_id = pr.prompt_id
        WHERE amp.tenant_id = 'SYSTEM'
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        throw new Error('NO_ACTIVE_MODEL_POINTER');
      }

      this.cachedConfig = result.rows[0];
      this.localCachedVersion = this.cachedConfig.configVersion;
      this.cacheExpiresAt = now + this.cacheTtlMs;

      return this.cachedConfig;
    } catch (err) {
      this.purgeLocalCache();
      throw err;
    }
  }

  public async promoteModel(
    candidateModelId: string,
    targetPromptId: string,
    contractVersion: string,
    operator: string,
    reason: string
  ): Promise<string> {
    const txClient = await this.pool.connect();

    try {
      await txClient.query('BEGIN');

      const currentRes = await txClient.query<{ model_id: string; prompt_id: string; decision_contract_version: string }>(
        "SELECT model_id, prompt_id, decision_contract_version FROM active_model_pointer WHERE tenant_id = 'SYSTEM' FOR UPDATE"
      );
      const current = currentRes.rows[0] || null;

      const modelMeta = await txClient.query<{ model_name: string; model_version: string }>(
        'SELECT model_name, model_version FROM approved_models WHERE model_id = $1',
        [candidateModelId]
      );
      const promptMeta = await txClient.query<{ version: string; system_prompt_hash: string }>(
        'SELECT version, system_prompt_hash FROM prompt_registry WHERE prompt_id = $1',
        [targetPromptId]
      );
      const benchMeta = await txClient.query<{ benchmark_id: string; accuracy: string }>(
        'SELECT benchmark_id, accuracy FROM model_benchmarks WHERE model_id = $1 ORDER BY executed_at DESC LIMIT 1',
        [candidateModelId]
      );

      if (modelMeta.rows.length === 0 || promptMeta.rows.length === 0) {
        throw new Error('INVALID_METADATA_REFERENCE');
      }

      const snapshot = {
        modelVersion: modelMeta.rows[0].model_version,
        promptVersion: promptMeta.rows[0].version,
        contractVersion,
        benchmarkId: benchMeta.rows[0]?.benchmark_id || null,
        benchmarkScore: benchMeta.rows[0]?.accuracy || null,
        systemPromptHash: promptMeta.rows[0].system_prompt_hash,
        promotedBy: operator,
        promotedAt: new Date().toISOString(),
      };

      const promoRes = await txClient.query<{ promotion_id: string }>(`
        INSERT INTO model_promotions (
          previous_model_id, new_model_id, previous_prompt_id, new_prompt_id,
          previous_contract, new_contract, benchmark_id, promoted_by, reason, runtime_snapshot
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING promotion_id
      `, [
        current?.model_id || null,
        candidateModelId,
        current?.prompt_id || null,
        targetPromptId,
        current?.decision_contract_version || null,
        contractVersion,
        benchMeta.rows[0]?.benchmark_id || null,
        operator,
        reason,
        snapshot,
      ]);

      const newPromotionId = promoRes.rows[0].promotion_id;

      await txClient.query(`
        INSERT INTO active_model_pointer (
          tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version, updated_at
        ) VALUES ('SYSTEM', $1, $2, $3, $4, 1, NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET
          model_id = EXCLUDED.model_id,
          prompt_id = EXCLUDED.prompt_id,
          current_promotion_id = EXCLUDED.current_promotion_id,
          decision_contract_version = EXCLUDED.decision_contract_version,
          config_version = active_model_pointer.config_version + 1,
          updated_at = NOW()
      `, [candidateModelId, targetPromptId, newPromotionId, contractVersion]);

      await txClient.query('COMMIT');
      await this.pool.query("NOTIFY model_changed, 'refresh'");

      return newPromotionId;
    } catch (err) {
      await txClient.query('ROLLBACK');
      throw err;
    } finally {
      txClient.release();
    }
  }

  public async rollbackToPromotion(targetPromotionId: string, _operator: string): Promise<void> {
    const txClient = await this.pool.connect();

    try {
      await txClient.query('BEGIN');

      const promoRes = await txClient.query<{
        previous_model_id: string | null;
        previous_prompt_id: string | null;
        previous_contract: string | null;
      }>(
        'SELECT previous_model_id, previous_prompt_id, previous_contract FROM model_promotions WHERE promotion_id = $1',
        [targetPromotionId]
      );

      if (promoRes.rows.length === 0) {
        throw new Error('PROMOTION_RECORD_NOT_FOUND');
      }

      const target = promoRes.rows[0];
      if (!target.previous_model_id || !target.previous_prompt_id || !target.previous_contract) {
        throw new Error('ROLLBACK_TARGET_INVALID');
      }

      const currentActive = await txClient.query<{ model_id: string }>(
        "SELECT model_id FROM active_model_pointer WHERE tenant_id = 'SYSTEM'"
      );
      if (currentActive.rows.length > 0) {
        await txClient.query('UPDATE approved_models SET status = $1 WHERE model_id = $2', [
          'ROLLED_BACK',
          currentActive.rows[0].model_id,
        ]);
      }

      await txClient.query(`
        UPDATE active_model_pointer
        SET model_id = $1,
            prompt_id = $2,
            current_promotion_id = $3,
            decision_contract_version = $4,
            config_version = config_version + 1,
            updated_at = NOW()
        WHERE tenant_id = 'SYSTEM'
      `, [target.previous_model_id, target.previous_prompt_id, targetPromotionId, target.previous_contract]);

      await txClient.query('COMMIT');
      await this.pool.query("NOTIFY model_changed, 'refresh'");
      this.purgeLocalCache();
    } catch (err) {
      await txClient.query('ROLLBACK');
      throw err;
    } finally {
      txClient.release();
    }
  }

  public async shutdown(): Promise<void> {
    this.cleanupListener();
  }

  public getDiagnostics(): { listenerConnected: boolean; cacheLoaded: boolean } {
    return {
      listenerConnected: this.isListening,
      cacheLoaded: this.cachedConfig !== null,
    };
  }
}
