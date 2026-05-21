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
    this.initNotificationBus().catch(() => {});
  }

  private async initNotificationBus(): Promise<void> {
    if (this.isListening) return;
    this.listenerClient = await this.pool.connect();
    await this.listenerClient.query('LISTEN model_changed');
    this.listenerClient.on('notification', (msg) => {
      if (msg.channel === 'model_changed') this.purgeLocalCache();
    });
    this.listenerClient.on('error', () => {
      this.cleanupListener();
      setTimeout(() => this.initNotificationBus().catch(() => {}), 5000);
    });
    this.isListening = true;
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
    const versionCheck = await this.pool.query<{ version: string }>(
      "SELECT config_version::text as version FROM active_model_pointer WHERE tenant_id = 'SYSTEM'"
    );
    if (versionCheck.rows.length === 0) throw new Error('NO_ACTIVE_MODEL_POINTER');
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
    if (result.rows.length === 0) throw new Error('NO_ACTIVE_MODEL_POINTER');
    this.cachedConfig = result.rows[0];
    this.localCachedVersion = this.cachedConfig.configVersion;
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return this.cachedConfig;
  }

  public getDiagnostics(): { listenerConnected: boolean; cacheLoaded: boolean } {
    return { listenerConnected: this.isListening, cacheLoaded: this.cachedConfig !== null };
  }
}
