-- Migration: 115_seed_governance_baseline
-- Phase: Phase 1G-B Governance Bootstrap Data Injection
-- Dependency: requires session setting app.governance_bootstrap_key

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF current_setting('app.governance_bootstrap_key', true) IS NULL
     OR current_setting('app.governance_bootstrap_key', true) = '' THEN
    RAISE EXCEPTION 'CRITICAL MIGRATION ABORTED: Missing required session variable app.governance_bootstrap_key';
  END IF;
END $$;

-- 1) prompt baseline
INSERT INTO prompt_registry (
  prompt_id, version, prompt_hash, system_prompt_hash, encrypted_prompt, approved
) VALUES (
  '01a11111-1111-1111-1111-111111111111',
  'p1',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  pgp_sym_encrypt('production telemetry analysis system prompt instructions v1.0', current_setting('app.governance_bootstrap_key')),
  TRUE
)
ON CONFLICT (version)
DO UPDATE SET
  prompt_hash = EXCLUDED.prompt_hash,
  system_prompt_hash = EXCLUDED.system_prompt_hash,
  encrypted_prompt = EXCLUDED.encrypted_prompt,
  approved = EXCLUDED.approved,
  updated_at = NOW();

-- 2) model baseline
INSERT INTO approved_models (
  model_id, provider, model_name, model_version, status, approved_by, notes
) VALUES (
  '02b22222-2222-2222-2222-222222222222',
  'ollama',
  'gemma2:9b',
  '2026.05.baseline',
  'APPROVED',
  'bootstrap',
  'Authoritative infrastructure baseline system model catalog entry.'
)
ON CONFLICT (model_version)
DO UPDATE SET
  provider = EXCLUDED.provider,
  model_name = EXCLUDED.model_name,
  approved_by = EXCLUDED.approved_by,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 3) benchmark baseline
INSERT INTO model_benchmarks (
  benchmark_id, model_id, dataset_version, accuracy, latency_ms, hallucination_rate, unsafe_action_rate, executed_at
) VALUES (
  '03c33333-3333-3333-3333-333333333333',
  '02b22222-2222-2222-2222-222222222222',
  'telemetry-golden-v1.0',
  98.40,
  1420,
  0.0100,
  0.0000,
  NOW()
)
ON CONFLICT (benchmark_id)
DO UPDATE SET
  model_id = EXCLUDED.model_id,
  dataset_version = EXCLUDED.dataset_version,
  accuracy = EXCLUDED.accuracy,
  latency_ms = EXCLUDED.latency_ms,
  hallucination_rate = EXCLUDED.hallucination_rate,
  unsafe_action_rate = EXCLUDED.unsafe_action_rate,
  executed_at = NOW(),
  updated_at = NOW();

-- 4) promotion baseline
INSERT INTO model_promotions (
  promotion_id, previous_model_id, new_model_id, previous_prompt_id, new_prompt_id,
  previous_contract, new_contract, benchmark_id, promoted_by, reason, runtime_snapshot
) VALUES (
  '04d44444-4444-4444-4444-444444444444',
  NULL,
  '02b22222-2222-2222-2222-222222222222',
  NULL,
  '01a11111-1111-1111-1111-111111111111',
  NULL,
  'v1.0',
  '03c33333-3333-3333-3333-333333333333',
  'bootstrap',
  'System initialization baseline orchestration state pass.',
  '{"modelVersion":"2026.05.baseline","promptVersion":"p1","contractVersion":"v1.0","benchmarkId":"03c33333-3333-3333-3333-333333333333","benchmarkScore":98.40,"systemPromptHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","promotedBy":"bootstrap"}'::jsonb
)
ON CONFLICT (promotion_id)
DO UPDATE SET
  new_model_id = EXCLUDED.new_model_id,
  new_prompt_id = EXCLUDED.new_prompt_id,
  new_contract = EXCLUDED.new_contract,
  benchmark_id = EXCLUDED.benchmark_id,
  promoted_by = EXCLUDED.promoted_by,
  reason = EXCLUDED.reason,
  runtime_snapshot = EXCLUDED.runtime_snapshot,
  promoted_at = NOW(),
  updated_at = NOW();

-- 5) active pointer baseline
INSERT INTO active_model_pointer (
  tenant_id, model_id, prompt_id, current_promotion_id, decision_contract_version, config_version, updated_at
) VALUES (
  'SYSTEM',
  '02b22222-2222-2222-2222-222222222222',
  '01a11111-1111-1111-1111-111111111111',
  '04d44444-4444-4444-4444-444444444444',
  'v1.0',
  1,
  NOW()
)
ON CONFLICT (tenant_id)
DO UPDATE SET
  model_id = EXCLUDED.model_id,
  prompt_id = EXCLUDED.prompt_id,
  current_promotion_id = EXCLUDED.current_promotion_id,
  decision_contract_version = EXCLUDED.decision_contract_version,
  config_version = GREATEST(active_model_pointer.config_version, EXCLUDED.config_version),
  updated_at = NOW();

COMMIT;
