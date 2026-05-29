/**
 * LLM Prompt Service
 *
 * Manages prompt template lifecycle and grounded inference execution.
 * Enforces the architecture rule: LLM must consume registered features, not raw data.
 *
 * Usage pattern (grounded inference):
 *   const snapshot = await resolveFeatures('tmpl-index-summary', indexName, tenantId);
 *   const template = await getTemplateByName('index_summary');
 *   const prompt = renderTemplate(template, snapshot);
 *   const result = await llmRouter.generate(prompt, {
 *     tenantId, decisionType: 'index_summary', featureSnapshot: snapshot.features
 *   });
 */

import { LLMRouter, LLMRouterResult } from '../../../agents/reasoning/llm-router';
import {
  LLMPromptTemplate,
  FeatureSnapshot,
  getAllTemplates,
  getTemplateById,
  getTemplateByName,
  createTemplate,
  resolveFeatures,
  renderTemplate,
  _clearFeatureCache
} from './llm-feature-service';
import { assertTenantIsolation } from '../../api/middleware/assert-tenant-isolation';
import { GoldRow } from './gold-scorer';

// Re-export for convenience
export { getAllTemplates, getTemplateById, getTemplateByName, createTemplate };

// ─────────────────────────────────────────────
// Grounded inference
// ─────────────────────────────────────────────

export interface GroundedInferenceResult {
  response: string;
  provider: string;
  latency_ms: number;
  fallback_used: boolean;
  inference_log_id?: string;
  feature_snapshot: FeatureSnapshot;
  template_id: string;
  unresolved_features: string[];
}

/**
 * Execute a grounded LLM inference:
 *   1. Resolve registered features for the index from Gold data
 *   2. Render the template with resolved features
 *   3. Call the LLM router (with feature snapshot for cost/audit log)
 *   4. Return response + full provenance (template, features used, unresolved)
 *
 * CRITICAL: This is the ONLY approved path for LLM inference in production.
 * Direct `llmRouter.generate()` calls bypass feature grounding and should only
 * be used for internal agent prompts (LLM decision agent, recommendation enrichment).
 */
export async function groundedInference(
  router: LLMRouter,
  templateId: string,
  indexName: string,
  tenantId: string,
  opts?: {
    goldRows?: GoldRow[];
    additionalContext?: Record<string, unknown>;
    requestId?: string;
    maxTokens?: number;
  }
): Promise<GroundedInferenceResult> {
  assertTenantIsolation(tenantId, 'llm-prompt-service:groundedInference');

  const template = await getTemplateById(templateId);
  if (!template) {
    throw new Error(`Prompt template not found: ${templateId}`);
  }

  // Resolve features from Gold data
  const featureSnapshot = await resolveFeatures(
    templateId,
    indexName,
    tenantId,
    opts?.goldRows
  );

  // Merge any additional context (non-registered fields the caller wants to add)
  if (opts?.additionalContext) {
    Object.assign(featureSnapshot.features, opts.additionalContext);
  }

  // Render template
  const prompt = renderTemplate(template, featureSnapshot);

  // Call LLM with full provenance for inference log
  const result = await router.generate(prompt, {
    tenantId,
    requestId: opts?.requestId,
    decisionType: template.name,
    promptTemplateId: templateId,
    featureSnapshot: featureSnapshot.features,
    maxTokens: opts?.maxTokens
  });

  return {
    response: result.response,
    provider: result.provider,
    latency_ms: result.latency_ms,
    fallback_used: result.fallback_used,
    inference_log_id: result.inference_log_id,
    feature_snapshot: featureSnapshot,
    template_id: templateId,
    unresolved_features: featureSnapshot.unresolved
  };
}

/**
 * Batch grounded inference for multiple indexes.
 * Processes serially to avoid overwhelming the LLM provider.
 */
export async function batchGroundedInference(
  router: LLMRouter,
  templateId: string,
  indexNames: string[],
  tenantId: string,
  goldRows?: GoldRow[]
): Promise<Map<string, GroundedInferenceResult>> {
  assertTenantIsolation(tenantId, 'llm-prompt-service:batchGroundedInference');

  const results = new Map<string, GroundedInferenceResult>();

  for (const indexName of indexNames) {
    try {
      const result = await groundedInference(router, templateId, indexName, tenantId, { goldRows });
      results.set(indexName, result);
    } catch (err) {
      console.warn('[GROUNDED_INFERENCE_FAILED]', {
        templateId,
        indexName,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString()
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// Inference cost summary
// ─────────────────────────────────────────────

export interface InferenceCostSummary {
  tenant_id: string;
  period: '24h' | '7d' | '30d';
  total_inferences: number;
  ollama_inferences: number;
  anthropic_inferences: number;
  fallback_rate_pct: number;
  total_cost_estimate: number;
  avg_latency_ms: number;
  error_count: number;
}

export async function getInferenceCostSummary(
  tenantId: string,
  period: '24h' | '7d' | '30d' = '24h'
): Promise<InferenceCostSummary> {
  assertTenantIsolation(tenantId, 'llm-prompt-service:getInferenceCostSummary');

  const intervalMap = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
  const interval = intervalMap[period];

  const dbModule = require('../../../core/database/connection');
  const queryFn = dbModule.query;

  const result = await queryFn(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN provider = 'ollama' THEN 1 ELSE 0 END) AS ollama_count,
       SUM(CASE WHEN provider = 'anthropic' THEN 1 ELSE 0 END) AS anthropic_count,
       SUM(CASE WHEN fallback_used = true THEN 1 ELSE 0 END) AS fallback_count,
       SUM(COALESCE(cost_estimate, 0)) AS total_cost,
       AVG(latency_ms) AS avg_latency,
       SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS error_count
     FROM llm_inference_log
     WHERE tenant_id = $1
       AND created_at > NOW() - INTERVAL '${interval}'`,
    [tenantId]
  );

  const row = result.rows[0];
  const total = parseInt(row?.total ?? '0', 10);
  const fallback = parseInt(row?.fallback_count ?? '0', 10);

  return {
    tenant_id: tenantId,
    period,
    total_inferences: total,
    ollama_inferences: parseInt(row?.ollama_count ?? '0', 10),
    anthropic_inferences: parseInt(row?.anthropic_count ?? '0', 10),
    fallback_rate_pct: total > 0 ? Math.round((fallback / total) * 100) : 0,
    total_cost_estimate: parseFloat(row?.total_cost ?? '0'),
    avg_latency_ms: Math.round(parseFloat(row?.avg_latency ?? '0')),
    error_count: parseInt(row?.error_count ?? '0', 10)
  };
}
