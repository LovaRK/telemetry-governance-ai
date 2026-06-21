/**
 * LLM Feature Service
 *
 * Manages the feature registry that grounds LLM inferences.
 * LLM prompts must consume registered features — never raw snapshots directly.
 *
 * Grounding rule (from architecture decision #6):
 *   async function groundedInference(templateId, indexName) {
 *     const features = await resolveFeatures(templateId, indexName); // ← this service
 *     const template = await getTemplate(templateId);
 *     const prompt = renderTemplate(template, features);
 *     return llmRouter.generate(prompt);
 *   }
 *
 * CRITICAL:
 * - Feature registry has 60s cache (less critical than governance 10s, but still bounded)
 * - Feature resolution validates that all template feature_refs are satisfied
 * - Unresolved features return null (never fabricated)
 * - Cache invalidated on any registry write
 */

import { query } from '../../../core/database/connection';
import { GoldRow, getAllCurrentGoldSnapshots } from './gold-scorer';
import { assertTenantIsolation } from '../../api/middleware/assert-tenant-isolation';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface LLMFeature {
  id: string;
  feature_name: string;
  description: string | null;
  source_table: string;
  source_column: string;
  transform: string | null;
  version: string;
  is_active: boolean;
  created_at: string;
}

export interface LLMPromptTemplate {
  id: string;
  name: string;
  template: string;
  feature_refs: string[];
  version: string;
  model_family: string | null;
  is_active: boolean;
  created_at: string;
}

export interface FeatureSnapshot {
  index_name: string;
  features: Record<string, unknown>;
  resolved_at: string;
  template_id?: string;
  unresolved: string[];
}

// ─────────────────────────────────────────────
// Feature registry cache (60s TTL)
// ─────────────────────────────────────────────

const FEATURE_CACHE_TTL_MS = 60_000;
let _featureCache: { features: LLMFeature[]; loaded_at: number } | null = null;
let _templateCache: { templates: LLMPromptTemplate[]; loaded_at: number } | null = null;

function isFeatureCacheValid(): boolean {
  return _featureCache !== null && (Date.now() - _featureCache.loaded_at) < FEATURE_CACHE_TTL_MS;
}
function isTemplateCacheValid(): boolean {
  return _templateCache !== null && (Date.now() - _templateCache.loaded_at) < FEATURE_CACHE_TTL_MS;
}

export function _clearFeatureCache(): void {
  _featureCache = null;
  _templateCache = null;
}

// ─────────────────────────────────────────────
// Feature Registry CRUD
// ─────────────────────────────────────────────

export async function getAllFeatures(activeOnly = true): Promise<LLMFeature[]> {
  if (isFeatureCacheValid()) {
    const features = _featureCache!.features;
    return activeOnly ? features.filter(f => f.is_active) : features;
  }

  const result = await query<LLMFeature>(
    `SELECT id, feature_name, description, source_table, source_column,
            transform, version, is_active, created_at::TEXT
     FROM llm_feature_registry
     ORDER BY source_table, feature_name`
  );

  _featureCache = { features: result.rows, loaded_at: Date.now() };
  return activeOnly ? result.rows.filter(f => f.is_active) : result.rows;
}

export async function getFeatureByName(name: string): Promise<LLMFeature | null> {
  const features = await getAllFeatures(false);
  return features.find(f => f.feature_name === name) ?? null;
}

export async function createFeature(input: Omit<LLMFeature, 'id' | 'created_at'>): Promise<LLMFeature> {
  const crypto = require('crypto');
  const id = `feat-${crypto.randomBytes(8).toString('hex')}`;

  const result = await query<LLMFeature>(
    `INSERT INTO llm_feature_registry
       (id, feature_name, description, source_table, source_column, transform, version, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, feature_name, description, source_table, source_column,
               transform, version, is_active, created_at::TEXT`,
    [id, input.feature_name, input.description, input.source_table, input.source_column,
     input.transform, input.version, input.is_active]
  );

  _featureCache = null;
  return result.rows[0];
}

// ─────────────────────────────────────────────
// Prompt Template CRUD
// ─────────────────────────────────────────────

export async function getAllTemplates(activeOnly = true): Promise<LLMPromptTemplate[]> {
  if (isTemplateCacheValid()) {
    const templates = _templateCache!.templates;
    return activeOnly ? templates.filter(t => t.is_active) : templates;
  }

  const result = await query<any>(
    `SELECT id, name, template, feature_refs, version, model_family, is_active, created_at::TEXT
     FROM llm_prompt_templates
     ORDER BY name, version`
  );

  const templates: LLMPromptTemplate[] = result.rows.map((r: any) => ({
    ...r,
    feature_refs: Array.isArray(r.feature_refs) ? r.feature_refs : []
  }));

  _templateCache = { templates, loaded_at: Date.now() };
  return activeOnly ? templates.filter(t => t.is_active) : templates;
}

export async function getTemplateById(id: string): Promise<LLMPromptTemplate | null> {
  const templates = await getAllTemplates(false);
  return templates.find(t => t.id === id) ?? null;
}

export async function getTemplateByName(name: string, version = '1.0'): Promise<LLMPromptTemplate | null> {
  const templates = await getAllTemplates(false);
  return templates.find(t => t.name === name && t.version === version) ?? null;
}

export async function createTemplate(
  input: Omit<LLMPromptTemplate, 'id' | 'created_at'>
): Promise<LLMPromptTemplate> {
  const crypto = require('crypto');
  const id = `tmpl-${crypto.randomBytes(8).toString('hex')}`;

  const result = await query<any>(
    `INSERT INTO llm_prompt_templates
       (id, name, template, feature_refs, version, model_family, is_active)
     VALUES ($1,$2,$3,$4::text[],$5,$6,$7)
     RETURNING id, name, template, feature_refs, version, model_family, is_active, created_at::TEXT`,
    [id, input.name, input.template, input.feature_refs, input.version,
     input.model_family, input.is_active]
  );

  _templateCache = null;
  return { ...result.rows[0], feature_refs: result.rows[0].feature_refs ?? [] };
}

// ─────────────────────────────────────────────
// Feature Resolution
// ─────────────────────────────────────────────

/**
 * Resolve registered features for a specific index from Gold snapshot data.
 * Returns a FeatureSnapshot with resolved values and list of any unresolved features.
 *
 * @param templateId   Template ID whose feature_refs to resolve
 * @param indexName    Index to resolve features for
 * @param tenantId     Tenant scope
 * @param goldRows     Optional pre-loaded Gold rows (avoids DB hit if already fetched)
 */
export async function resolveFeatures(
  templateId: string,
  indexName: string,
  tenantId: string,
  goldRows?: GoldRow[]
): Promise<FeatureSnapshot> {
  assertTenantIsolation(tenantId, 'llm-feature-service:resolveFeatures');

  const template = await getTemplateById(templateId);
  if (!template) {
    return {
      index_name: indexName,
      features: {},
      resolved_at: new Date().toISOString(),
      template_id: templateId,
      unresolved: []
    };
  }

  const allFeatures = await getAllFeatures(true);
  const featureMap = new Map(allFeatures.map(f => [f.feature_name, f]));

  // Get Gold data for this index
  let goldRow: GoldRow | undefined;
  if (goldRows) {
    goldRow = goldRows.find(r => r.index_name === indexName);
  } else {
    const rows = await getAllCurrentGoldSnapshots(tenantId, { limit: 1 });
    goldRow = rows.find(r => r.index_name === indexName);
  }

  const resolved: Record<string, unknown> = { index_name: indexName };
  const unresolved: string[] = [];

  for (const featureName of template.feature_refs) {
    const featureDef = featureMap.get(featureName);
    if (!featureDef) {
      unresolved.push(featureName);
      resolved[featureName] = null;
      continue;
    }

    // Resolve from Gold row (primary source for most features)
    if (featureDef.source_table === 'gold_telemetry_snapshots' && goldRow) {
      const value = (goldRow as any)[featureDef.source_column];
      resolved[featureName] = value ?? null;
      if (value === undefined) unresolved.push(featureName);
    } else {
      // Feature requires a different source — mark as unresolved for now
      resolved[featureName] = null;
      unresolved.push(featureName);
    }
  }

  if (unresolved.length > 0) {
    console.warn('[LLM_FEATURE_UNRESOLVED]', {
      template_id: templateId,
      index_name: indexName,
      unresolved,
      timestamp: new Date().toISOString()
    });
  }

  return {
    index_name: indexName,
    features: resolved,
    resolved_at: new Date().toISOString(),
    template_id: templateId,
    unresolved
  };
}

/**
 * Render a prompt template with resolved feature values.
 * Simple {{variable}} substitution — Handlebars-compatible for basic cases.
 */
export function renderTemplate(template: LLMPromptTemplate, featureSnapshot: FeatureSnapshot): string {
  let rendered = template.template;

  // Handle {{#if field}}...{{/if}} blocks
  rendered = rendered.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, content) => {
      const val = featureSnapshot.features[key];
      return val ? content : '';
    }
  );

  // Replace {{variable}} with feature values
  rendered = rendered.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = featureSnapshot.features[key];
    if (val === undefined || val === null) return '';
    return String(val);
  });

  return rendered.trim();
}

// ─────────────────────────────────────────────
// Inference cost helpers
// ─────────────────────────────────────────────

// Approximate cost rates (per 1K tokens)
const ANTHROPIC_COST_PER_1K_INPUT = 0.003;   // claude-3-sonnet approximate
const ANTHROPIC_COST_PER_1K_OUTPUT = 0.015;
const OLLAMA_COST_PER_1K = 0.0;              // local model — no token cost

export function estimateInferenceCost(
  provider: string,
  promptTokens: number,
  completionTokens: number
): number {
  if (provider === 'anthropic') {
    return (promptTokens / 1000) * ANTHROPIC_COST_PER_1K_INPUT +
           (completionTokens / 1000) * ANTHROPIC_COST_PER_1K_OUTPUT;
  }
  return OLLAMA_COST_PER_1K; // Ollama = $0
}
