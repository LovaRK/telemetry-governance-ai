BEGIN;

CREATE TABLE IF NOT EXISTS prompt_registry (
  prompt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(32) NOT NULL UNIQUE,
  encrypted_prompt BYTEA NOT NULL,
  prompt_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_registry_version ON prompt_registry(version);
CREATE INDEX IF NOT EXISTS idx_prompt_hash ON prompt_registry(prompt_hash);

CREATE TABLE IF NOT EXISTS approved_models (
  model_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('CANDIDATE','BENCHMARKING','APPROVED','DEPRECATED','ROLLED_BACK')),
  approved_by VARCHAR(100) NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approved_models_status ON approved_models(status);

CREATE TABLE IF NOT EXISTS model_benchmarks (
  benchmark_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES approved_models(model_id) ON DELETE CASCADE,
  dataset_version VARCHAR(50) NOT NULL,
  accuracy NUMERIC(5,2) NOT NULL,
  latency_ms INT NOT NULL,
  hallucination_rate NUMERIC(5,4) NOT NULL,
  unsafe_action_rate NUMERIC(5,4) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_benchmarks_lookup ON model_benchmarks(model_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS model_promotions (
  promotion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_model_id UUID REFERENCES approved_models(model_id),
  new_model_id UUID NOT NULL REFERENCES approved_models(model_id),
  previous_prompt_id UUID REFERENCES prompt_registry(prompt_id),
  new_prompt_id UUID NOT NULL REFERENCES prompt_registry(prompt_id),
  previous_contract VARCHAR(32),
  new_contract VARCHAR(32) NOT NULL,
  benchmark_id UUID REFERENCES model_benchmarks(benchmark_id),
  promoted_by VARCHAR(100) NOT NULL,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL,
  runtime_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_promotions_timeline ON model_promotions(promoted_at DESC);

CREATE TABLE IF NOT EXISTS active_model_pointer (
  tenant_id VARCHAR(50) PRIMARY KEY DEFAULT 'SYSTEM',
  model_id UUID NOT NULL REFERENCES approved_models(model_id),
  prompt_id UUID NOT NULL REFERENCES prompt_registry(prompt_id),
  current_promotion_id UUID NOT NULL REFERENCES model_promotions(promotion_id),
  decision_contract_version VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_pointer_model ON active_model_pointer(model_id);

ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS model_governance_id UUID,
  ADD COLUMN IF NOT EXISTS prompt_governance_id UUID,
  ADD COLUMN IF NOT EXISTS promotion_id UUID,
  ADD COLUMN IF NOT EXISTS decision_contract_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS model_version VARCHAR(64),
  ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_decisions_model_governance_id_fkey'
  ) THEN
    ALTER TABLE agent_decisions
      ADD CONSTRAINT agent_decisions_model_governance_id_fkey
      FOREIGN KEY (model_governance_id) REFERENCES approved_models(model_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_decisions_prompt_governance_id_fkey'
  ) THEN
    ALTER TABLE agent_decisions
      ADD CONSTRAINT agent_decisions_prompt_governance_id_fkey
      FOREIGN KEY (prompt_governance_id) REFERENCES prompt_registry(prompt_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_decisions_promotion_id_fkey'
  ) THEN
    ALTER TABLE agent_decisions
      ADD CONSTRAINT agent_decisions_promotion_id_fkey
      FOREIGN KEY (promotion_id) REFERENCES model_promotions(promotion_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_decisions_model ON agent_decisions(model_governance_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_prompt ON agent_decisions(prompt_governance_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_promotion ON agent_decisions(promotion_id);

COMMIT;
