import { Client } from 'pg';

export interface DecisionHistoryRecord {
  snapshotId: number;
  snapshotDate: string;
  indexName: string;
  tierPrevious?: string;
  tierCurrent: string;
  actionPrevious?: string;
  actionCurrent: string;
  confidenceChanged: boolean;
  scoreDelta?: number;
  changeReason?: string;
}

export interface ConfigAuditRecord {
  configKey: string;
  changeType: 'cost_model' | 'retention_policy' | 'decision_weights';
  oldValue?: Record<string, any>;
  newValue: Record<string, any>;
  changedBy?: string;
  changeReason?: string;
}

export interface LLMPromptVersion {
  version: number;
  promptTemplate: string;
  modelName: string;
  notes?: string;
  createdAt: Date;
  activatedAt?: Date;
}

export async function recordDecisionChange(
  client: Client,
  record: DecisionHistoryRecord
): Promise<number> {
  const result = await client.query(
    `INSERT INTO decision_history (
      snapshot_id, snapshot_date, index_name, tier_previous, tier_current,
      action_previous, action_current, confidence_changed, score_delta, change_reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      record.snapshotId,
      record.snapshotDate,
      record.indexName,
      record.tierPrevious,
      record.tierCurrent,
      record.actionPrevious,
      record.actionCurrent,
      record.confidenceChanged,
      record.scoreDelta,
      record.changeReason,
    ]
  );
  return result.rows[0].id;
}

export async function recordConfigChange(
  client: Client,
  audit: ConfigAuditRecord
): Promise<number> {
  const result = await client.query(
    `INSERT INTO config_audit_log (
      config_key, change_type, old_value, new_value, changed_by, change_reason
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id`,
    [
      audit.configKey,
      audit.changeType,
      audit.oldValue ? JSON.stringify(audit.oldValue) : null,
      JSON.stringify(audit.newValue),
      audit.changedBy || 'system',
      audit.changeReason,
    ]
  );
  return result.rows[0].id;
}

export async function getDecisionHistory(
  client: Client,
  indexName?: string,
  limit: number = 50,
  offset: number = 0
): Promise<DecisionHistoryRecord[]> {
  const query = `
    SELECT
      snapshot_id, snapshot_date, index_name, tier_previous, tier_current,
      action_previous, action_current, confidence_changed, score_delta, change_reason
    FROM decision_history
    ${indexName ? 'WHERE index_name = $1' : ''}
    ORDER BY created_at DESC
    LIMIT $${indexName ? '2' : '1'} OFFSET $${indexName ? '3' : '2'}
  `;

  const params = indexName ? [indexName, limit, offset] : [limit, offset];
  const result = await client.query(query, params);

  return result.rows.map(row => ({
    snapshotId: row.snapshot_id,
    snapshotDate: row.snapshot_date,
    indexName: row.index_name,
    tierPrevious: row.tier_previous,
    tierCurrent: row.tier_current,
    actionPrevious: row.action_previous,
    actionCurrent: row.action_current,
    confidenceChanged: row.confidence_changed,
    scoreDelta: row.score_delta,
    changeReason: row.change_reason,
  }));
}

export async function getConfigAuditTrail(
  client: Client,
  limit: number = 50,
  offset: number = 0
): Promise<ConfigAuditRecord[]> {
  const result = await client.query(
    `SELECT
      config_key, change_type, old_value, new_value, changed_by, change_reason
    FROM config_audit_log
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows.map(row => ({
    configKey: row.config_key,
    changeType: row.change_type,
    oldValue: row.old_value ? JSON.parse(row.old_value) : undefined,
    newValue: JSON.parse(row.new_value),
    changedBy: row.changed_by,
    changeReason: row.change_reason,
  }));
}

export async function getCurrentLLMPromptVersion(
  client: Client
): Promise<LLMPromptVersion | null> {
  const result = await client.query(
    `SELECT version, prompt_template, model_name, notes, created_at, activated_at
    FROM llm_prompt_versions
    WHERE activated_at IS NOT NULL
    ORDER BY activated_at DESC
    LIMIT 1`
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    version: row.version,
    promptTemplate: row.prompt_template,
    modelName: row.model_name,
    notes: row.notes,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  };
}

export async function recordLLMPromptChange(
  client: Client,
  promptTemplate: string,
  modelName: string,
  notes?: string
): Promise<LLMPromptVersion> {
  // Get next version number
  const versionResult = await client.query(
    'SELECT MAX(version) as max_version FROM llm_prompt_versions'
  );
  const nextVersion = (versionResult.rows[0].max_version || 0) + 1;

  // Insert new prompt version
  const result = await client.query(
    `INSERT INTO llm_prompt_versions (version, prompt_template, model_name, notes, activated_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING version, prompt_template, model_name, notes, created_at, activated_at`,
    [nextVersion, promptTemplate, modelName, notes]
  );

  const row = result.rows[0];
  return {
    version: row.version,
    promptTemplate: row.prompt_template,
    modelName: row.model_name,
    notes: row.notes,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  };
}
