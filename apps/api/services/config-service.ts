import { query } from '../../../core/database/connection';

export interface UserConfig {
  id: number;
  configKey: string;
  costPerGbPerDay: number;
  maxRetentionDays: number;
  maxParallel: number;
  decisionWeights: Record<string, number>;
  retentionPolicy: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_CONFIG: Omit<UserConfig, 'id' | 'createdAt' | 'updatedAt'> = {
  configKey: 'default',
  costPerGbPerDay: 10.00,   // $3,650/GB/year ÷ 365 = $10/day (Splunk Enterprise legacy rate)
  maxRetentionDays: 730,
  maxParallel: 2,
  decisionWeights: {},
  retentionPolicy: {
    CRITICAL: 730,
    IMPORTANT: 365,
    NICE_TO_HAVE: 90,
    LOW_VALUE: 30,
  },
};

export async function loadUserConfig(): Promise<UserConfig> {
  const result = await query<UserConfig>(
    `SELECT id, config_key as "configKey", cost_per_gb_per_day as "costPerGbPerDay",
            max_retention_days as "maxRetentionDays", max_parallel as "maxParallel",
            decision_weights as "decisionWeights", retention_policy as "retentionPolicy",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM user_config WHERE config_key = 'default'`
  );

  if (result.rows.length === 0) {
    await query(
      `INSERT INTO user_config (config_key, cost_per_gb_per_day, max_retention_days, max_parallel)
       VALUES ('default', $1, $2, $3)`,
      [DEFAULT_CONFIG.costPerGbPerDay, DEFAULT_CONFIG.maxRetentionDays, DEFAULT_CONFIG.maxParallel]
    );
    return {
      ...DEFAULT_CONFIG,
      id: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return result.rows[0];
}

export async function updateUserConfig(updates: Partial<Omit<UserConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<UserConfig> {
  const current = await loadUserConfig();
  
  const costPerGbPerDay = updates.costPerGbPerDay ?? current.costPerGbPerDay;
  const maxRetentionDays = updates.maxRetentionDays ?? current.maxRetentionDays;
  const maxParallel = updates.maxParallel ?? current.maxParallel;
  const decisionWeights = updates.decisionWeights ?? current.decisionWeights;
  const retentionPolicy = updates.retentionPolicy ?? current.retentionPolicy;

  await query(
    `UPDATE user_config 
     SET cost_per_gb_per_day = $1, max_retention_days = $2, max_parallel = $3,
         decision_weights = $4, retention_policy = $5, updated_at = NOW()
     WHERE config_key = 'default'`,
    [costPerGbPerDay, maxRetentionDays, maxParallel, JSON.stringify(decisionWeights), JSON.stringify(retentionPolicy)]
  );

  return loadUserConfig();
}

export async function updateCostModel(costPerGbPerDay: number): Promise<UserConfig> {
  if (costPerGbPerDay < 0.01 || costPerGbPerDay > 500) {
    // $0.01–$500/GB/day covers $3.65/yr to $182,500/yr — handles all known Splunk contracts
    throw new Error('Cost per GB per day must be between 0.01 and 500.00');
  }
  return updateUserConfig({ costPerGbPerDay });
}

export async function updateRetentionPolicy(retentionPolicy: Record<string, number>): Promise<UserConfig> {
  return updateUserConfig({ retentionPolicy });
}

export async function updateDecisionWeights(decisionWeights: Record<string, number>): Promise<UserConfig> {
  return updateUserConfig({ decisionWeights });
}