-- Migration: 114_phase_1g_b_governance_compat
-- Phase: Phase 1G-B Governance Backward-Compatibility Extension

BEGIN;

-- 1) prompt_registry compatibility columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='prompt_registry' AND column_name='system_prompt_hash'
  ) THEN
    ALTER TABLE prompt_registry ADD COLUMN system_prompt_hash VARCHAR(64);
  END IF;
END $$;

UPDATE prompt_registry
SET system_prompt_hash = prompt_hash
WHERE system_prompt_hash IS NULL;

ALTER TABLE prompt_registry ALTER COLUMN system_prompt_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='prompt_registry' AND column_name='approved'
  ) THEN
    ALTER TABLE prompt_registry ADD COLUMN approved BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- 2) active_model_pointer compatibility columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='active_model_pointer' AND column_name='current_promotion_id'
  ) THEN
    ALTER TABLE active_model_pointer
      ADD COLUMN current_promotion_id UUID REFERENCES model_promotions(promotion_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='active_model_pointer' AND column_name='config_version'
  ) THEN
    ALTER TABLE active_model_pointer
      ADD COLUMN config_version BIGINT NOT NULL DEFAULT 1;
  END IF;
END $$;

-- 3) model_benchmarks compatibility columns for service queries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='model_benchmarks' AND column_name='executed_at'
  ) THEN
    ALTER TABLE model_benchmarks
      ADD COLUMN executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='model_benchmarks' AND column_name='accuracy'
  ) THEN
    ALTER TABLE model_benchmarks
      ADD COLUMN accuracy NUMERIC(5,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 4) model_promotions compatibility columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='model_promotions' AND column_name='benchmark_id'
  ) THEN
    ALTER TABLE model_promotions
      ADD COLUMN benchmark_id UUID REFERENCES model_benchmarks(benchmark_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='model_promotions' AND column_name='runtime_snapshot'
  ) THEN
    ALTER TABLE model_promotions
      ADD COLUMN runtime_snapshot JSONB;
  END IF;
END $$;

UPDATE model_promotions
SET runtime_snapshot = '{}'::jsonb
WHERE runtime_snapshot IS NULL;

ALTER TABLE model_promotions ALTER COLUMN runtime_snapshot SET NOT NULL;

-- 5) indexes for runtime lookups
CREATE INDEX IF NOT EXISTS idx_prompt_registry_system_hash
ON prompt_registry(system_prompt_hash);

CREATE INDEX IF NOT EXISTS idx_active_pointer_config
ON active_model_pointer(tenant_id, config_version);

COMMIT;
