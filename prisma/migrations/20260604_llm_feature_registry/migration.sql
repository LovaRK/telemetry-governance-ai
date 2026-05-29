-- Phase 7: LLM Feature Registry + Prompt Templates + Inference Log
--
-- Three tables that enforce the "grounded inference" rule:
--   LLM must consume registered semantic features — NOT raw snapshots directly.
--   Every inference is logged with the feature snapshot used (for replay).
--
-- CRITICAL:
-- - llm_inference_log is APPEND-ONLY (immutable cost + audit record)
-- - Every inference through llm-router.ts writes one row here
-- - feature_snapshot in the log enables inference replay and drift detection
-- - cost_estimate is best-effort (null if provider doesn't report tokens)

-- ─────────────────────────────────────────────
-- Feature Registry
-- Defines which Gold/Silver fields are available to LLM prompts.
-- LLM grounding rule: only registered features can be referenced in templates.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "llm_feature_registry" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "feature_name"  TEXT        NOT NULL,
  "description"   TEXT,
  "source_table"  TEXT        NOT NULL,   -- e.g. 'gold_telemetry_snapshots'
  "source_column" TEXT        NOT NULL,   -- e.g. 'composite_score'
  "transform"     TEXT,                   -- optional normalization expression
  "version"       TEXT        NOT NULL DEFAULT '1.0',
  "is_active"     BOOLEAN     NOT NULL DEFAULT true,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "llm_feature_registry_name_unique" UNIQUE ("feature_name")
);

CREATE INDEX IF NOT EXISTS "llm_feature_registry_active_idx"
  ON "llm_feature_registry" ("is_active", "source_table");

-- Seed canonical Gold-layer features
INSERT INTO "llm_feature_registry"
  ("id", "feature_name", "description", "source_table", "source_column", "version")
VALUES
  ('feat-composite-score',    'composite_score',       'Weighted composite KPI score (0-100)',          'gold_telemetry_snapshots', 'composite_score',      '1.0'),
  ('feat-utilization-score',  'utilization_score',     'Index utilization score (0-100)',               'gold_telemetry_snapshots', 'utilization_score',    '1.0'),
  ('feat-detection-score',    'detection_score',       'Security detection coverage score (0-100)',     'gold_telemetry_snapshots', 'detection_score',      '1.0'),
  ('feat-quality-score',      'quality_score',         'Parsing and field quality score (0-100)',       'gold_telemetry_snapshots', 'quality_score',        '1.0'),
  ('feat-tier',               'tier',                  'Value tier classification',                     'gold_telemetry_snapshots', 'tier',                 '1.0'),
  ('feat-min-activity-gate',  'minimum_activity_gated','Whether minimum activity gate was applied',     'gold_telemetry_snapshots', 'minimum_activity_gated','1.0'),
  ('feat-scoring-version',    'scoring_version',       'Scoring model version that produced this row',  'gold_telemetry_snapshots', 'scoring_version',      '1.0'),
  ('feat-event-count',        'event_count',           'Total event count from Silver normalization',   'silver_normalized_telemetry', 'event_count',       '1.0'),
  ('feat-parsing-error-rate', 'parsing_error_rate',    'Parsing error rate % from Silver normalization','silver_normalized_telemetry', 'parsing_error_rate','1.0'),
  ('feat-field-coverage',     'field_coverage_pct',    'Field coverage % from Silver normalization',   'silver_normalized_telemetry', 'field_coverage_pct','1.0'),
  ('feat-time-span-days',     'time_span_days',        'Time span of data in days',                    'silver_normalized_telemetry', 'time_span_days',     '1.0')
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────
-- Prompt Templates
-- Versioned Handlebars-style templates that reference feature_registry entries.
-- Templates must declare which features they consume via feature_refs[].
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "llm_prompt_templates" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "name"          TEXT        NOT NULL,
  "template"      TEXT        NOT NULL,       -- Handlebars/mustache template body
  "feature_refs"  TEXT[]      NOT NULL,       -- References to llm_feature_registry.feature_name
  "version"       TEXT        NOT NULL DEFAULT '1.0',
  "model_family"  TEXT,                       -- 'llama3' | 'claude' | '*' (null = all)
  "is_active"     BOOLEAN     NOT NULL DEFAULT true,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "llm_prompt_templates_name_version_unique" UNIQUE ("name", "version")
);

CREATE INDEX IF NOT EXISTS "llm_prompt_templates_active_idx"
  ON "llm_prompt_templates" ("is_active", "name");

-- Seed core templates
INSERT INTO "llm_prompt_templates"
  ("id", "name", "template", "feature_refs", "version", "model_family", "is_active")
VALUES (
  'tmpl-index-summary',
  'index_summary',
  'You are a Splunk FinOps analyst. Summarize the following index KPIs in 2-3 sentences for an operator dashboard. Focus on actionable insights. Do not invent data.\n\nIndex: {{index_name}}\nComposite Score: {{composite_score}}/100\nTier: {{tier}}\nUtilization: {{utilization_score}}/100\nDetection Coverage: {{detection_score}}/100\nData Quality: {{quality_score}}/100\n{{#if minimum_activity_gated}}Note: Score was gated by minimum activity rule — this index has very low activity.{{/if}}\n\nProvide a concise operator-facing summary.',
  ARRAY['composite_score','utilization_score','detection_score','quality_score','tier','minimum_activity_gated'],
  '1.0',
  '*',
  true
), (
  'tmpl-recommendation-enrichment',
  'recommendation_enrichment',
  'You are a Splunk FinOps analyst. Enrich the following deterministic recommendation with a plain-English explanation.\n\nRecommendation Type: {{type}}\nIndex: {{index_name}}\nPriority: {{priority}}\nDeterministic Reason: {{deterministic_reason}}\nComposite Score: {{composite_score}}/100\nTier: {{tier}}\nEstimated Savings: {{savings_estimate}} units\n\nWrite 1-3 sentences explaining this recommendation to an operator. Be specific and actionable. Do not change the recommendation type.',
  ARRAY['composite_score','tier'],
  '1.0',
  '*',
  true
)
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────
-- Inference Log (APPEND-ONLY)
-- Every inference call through llm-router.ts writes one row.
-- Used for: cost tracking, fallback auditing, drift detection, replay.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "llm_inference_log" (
  "id"                  TEXT        NOT NULL PRIMARY KEY,
  "tenant_id"           TEXT        NOT NULL,
  "request_id"          TEXT        NOT NULL,        -- Caller-provided correlation ID
  "provider"            TEXT        NOT NULL,        -- 'ollama' | 'anthropic'
  "model"               TEXT        NOT NULL,
  "prompt_tokens"       INTEGER,
  "completion_tokens"   INTEGER,
  "total_tokens"        INTEGER,
  "latency_ms"          INTEGER     NOT NULL,
  "cost_estimate"       REAL,                        -- Nullable: Ollama has no token cost
  "fallback_used"       BOOLEAN     NOT NULL DEFAULT false,
  "fallback_reason"     TEXT,
  "decision_type"       TEXT,                        -- e.g. 'index_summary', 'recommendation_enrichment'
  "prompt_template_id"  TEXT,                        -- FK to llm_prompt_templates (nullable)
  "feature_snapshot"    JSONB,                       -- Registered features used (for replay)
  "error"               TEXT,                        -- Non-null if inference failed
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "llm_inference_log_provider_check"
    CHECK ("provider" IN ('ollama', 'anthropic', 'unknown'))
);

-- Hot query paths
CREATE INDEX IF NOT EXISTS "llm_inference_log_tenant_idx"
  ON "llm_inference_log" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "llm_inference_log_provider_idx"
  ON "llm_inference_log" ("provider", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "llm_inference_log_decision_type_idx"
  ON "llm_inference_log" ("decision_type", "created_at" DESC)
  WHERE "decision_type" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "llm_inference_log_fallback_idx"
  ON "llm_inference_log" ("fallback_used", "created_at" DESC)
  WHERE "fallback_used" = true;

-- Cost aggregation (for daily budget queries)
CREATE INDEX IF NOT EXISTS "llm_inference_log_cost_idx"
  ON "llm_inference_log" ("tenant_id", "created_at" DESC)
  WHERE "cost_estimate" IS NOT NULL;
