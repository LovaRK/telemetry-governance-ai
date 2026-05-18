import { PoolClient } from 'pg';

export type OverrideScopeType = 'INDEX' | 'SOURCETYPE' | 'PATTERN' | 'GLOBAL';
export type OverrideReasonCode =
  | 'COMPLIANCE'
  | 'LEGAL_HOLD'
  | 'BUSINESS_CRITICAL'
  | 'FALSE_POSITIVE'
  | 'TEMP_SPIKE'
  | 'SECURITY_POLICY'
  | 'INVESTIGATION_ACTIVE';
export type OverrideReviewStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';

export interface DecisionOverride {
  overrideId: string;
  snapshotId: string;
  scopeType: OverrideScopeType;
  scopeValue: string; // index_name, sourcetype, pattern, or 'GLOBAL'
  overrideAction: string; // KEEP, OPTIMIZE, ARCHIVE, etc.
  overrideTier?: string;
  reasonCode: OverrideReasonCode;
  reasonText: string;
  priority: number; // 1-100
  createdBy: string;
  createdAt: Date;
  expiresAt?: Date;
  reviewRequired: boolean;
  reviewStatus: OverrideReviewStatus;
  approvalChain?: string[];
  active: boolean;
}

// Scope precedence order (higher = more specific = higher priority)
const SCOPE_PRECEDENCE: Record<OverrideScopeType, number> = {
  GLOBAL: 1,
  PATTERN: 2,
  SOURCETYPE: 3,
  INDEX: 4,
};

// Fetch applicable overrides for a given index
export async function getApplicableOverrides(
  client: PoolClient,
  indexName: string,
  sourcetype: string | null,
  snapshotId: string
): Promise<DecisionOverride[]> {
  const result = await client.query(
    `SELECT * FROM decision_overrides
     WHERE snapshot_id = $1 AND active = true
     AND (
       (scope_type = 'INDEX' AND scope_value = $2)
       OR (scope_type = 'SOURCETYPE' AND scope_value = $3)
       OR (scope_type = 'PATTERN' AND $2 LIKE scope_value)
       OR scope_type = 'GLOBAL'
     )
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [snapshotId, indexName, sourcetype || null]
  );

  return result.rows.map((row: any) => ({
    overrideId: row.id,
    snapshotId: row.snapshot_id,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    overrideAction: row.override_action,
    overrideTier: row.override_tier,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    priority: row.priority,
    createdBy: row.override_actor,
    createdAt: row.created_at,
    expiresAt: row.override_expiry,
    reviewRequired: row.review_required,
    reviewStatus: row.review_status,
    approvalChain: row.approval_chain,
    active: row.active,
  }));
}

// Resolve which override wins (scope precedence, then priority)
export function resolveOverride(overrides: DecisionOverride[]): DecisionOverride | null {
  if (overrides.length === 0) return null;

  // Sort by scope precedence (descending - higher precedence first)
  const sorted = [...overrides].sort((a, b) => {
    const scopeDiff = SCOPE_PRECEDENCE[b.scopeType] - SCOPE_PRECEDENCE[a.scopeType];
    if (scopeDiff !== 0) return scopeDiff;
    // If same scope, sort by priority (higher first)
    return b.priority - a.priority;
  });

  return sorted[0];
}

// Auto-disable expired overrides
export async function disableExpiredOverrides(client: PoolClient): Promise<number> {
  const result = await client.query(
    `UPDATE decision_overrides
     SET active = false, review_status = 'EXPIRED'
     WHERE active = true AND expires_at IS NOT NULL AND expires_at <= NOW()
     RETURNING id`
  );

  return result.rowCount || 0;
}

// Flag overrides for review if older than 180 days
export async function flagOverduesForReview(client: PoolClient): Promise<number> {
  const result = await client.query(
    `UPDATE decision_overrides
     SET review_required = true
     WHERE review_status = 'APPROVED'
     AND created_at <= NOW() - INTERVAL '180 days'
     AND review_required = false
     RETURNING id`
  );

  return result.rowCount || 0;
}

// Create an override
export async function createOverride(
  client: PoolClient,
  override: Omit<DecisionOverride, 'overrideId' | 'createdAt'>
): Promise<DecisionOverride> {
  const result = await client.query(
    `INSERT INTO decision_overrides (
      snapshot_id, scope_type, scope_value, override_action, override_tier,
      reason_code, reason_text, priority, override_actor, override_expiry,
      review_required, review_status, approval_chain, active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      override.snapshotId,
      override.scopeType,
      override.scopeValue,
      override.overrideAction,
      override.overrideTier || null,
      override.reasonCode,
      override.reasonText,
      override.priority,
      override.createdBy,
      override.expiresAt || null,
      override.reviewRequired,
      override.reviewStatus,
      JSON.stringify(override.approvalChain || []),
      override.active,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create override');
  }

  const row = result.rows[0];
  return {
    overrideId: row.id,
    snapshotId: row.snapshot_id,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    overrideAction: row.override_action,
    overrideTier: row.override_tier,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    priority: row.priority,
    createdBy: row.override_actor,
    createdAt: row.created_at,
    expiresAt: row.override_expiry,
    reviewRequired: row.review_required,
    reviewStatus: row.review_status,
    approvalChain: row.approval_chain,
    active: row.active,
  };
}

// Update override status
export async function updateOverrideStatus(
  client: PoolClient,
  overrideId: string,
  reviewStatus: OverrideReviewStatus,
  reviewedBy?: string
): Promise<void> {
  await client.query(
    `UPDATE decision_overrides
     SET review_status = $1, reviewed_at = NOW(), reviewed_by = $2, updated_at = NOW()
     WHERE id = $3`,
    [reviewStatus, reviewedBy || null, overrideId]
  );
}

// Validate reason code
export function isValidReasonCode(code: string): code is OverrideReasonCode {
  const validCodes: OverrideReasonCode[] = [
    'COMPLIANCE',
    'LEGAL_HOLD',
    'BUSINESS_CRITICAL',
    'FALSE_POSITIVE',
    'TEMP_SPIKE',
    'SECURITY_POLICY',
    'INVESTIGATION_ACTIVE',
  ];
  return validCodes.includes(code as OverrideReasonCode);
}

export function getReasonCodeDescription(code: OverrideReasonCode): string {
  const descriptions: Record<OverrideReasonCode, string> = {
    COMPLIANCE: 'Regulatory requirement',
    LEGAL_HOLD: 'Cannot archive',
    BUSINESS_CRITICAL: 'Operational dependency',
    FALSE_POSITIVE: 'AI mistake',
    TEMP_SPIKE: 'Temporary anomaly',
    SECURITY_POLICY: 'Mandated retention',
    INVESTIGATION_ACTIVE: 'Current incident response',
  };
  return descriptions[code] || 'Unknown';
}
