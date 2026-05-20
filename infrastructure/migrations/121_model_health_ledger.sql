-- Migration 121: Create model_health_ledger and add days_since_review to human_review_ledger
-- Date: 2026-05-20
-- Purpose: Track model health metrics (trust score, rejection rate) and review recency
-- Related to: /api/model-health endpoint, trust-decay-service

-- Note: days_since_review is calculated dynamically in queries using:
-- FLOOR(EXTRACT(EPOCH FROM (NOW() - reviewed_at)) / 86400)::INTEGER
-- No need to store it as a column since it changes daily

-- Create model_health_ledger table for model trust score tracking
CREATE TABLE IF NOT EXISTS model_health_ledger (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  total_reviews_30d INTEGER DEFAULT 0,
  total_rejections_30d INTEGER DEFAULT 0,
  stale_approvals_count INTEGER DEFAULT 0,
  expired_approvals_count INTEGER DEFAULT 0,
  system_health_status VARCHAR(32) DEFAULT 'HEALTHY'
    CHECK (system_health_status IN ('HEALTHY', 'DEGRADED', 'CRITICAL')),
  alert_message TEXT,
  model_trust_score NUMERIC(4, 3) DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_health_ledger_snapshot_date ON model_health_ledger(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_model_health_ledger_system_health_status ON model_health_ledger(system_health_status);
CREATE INDEX IF NOT EXISTS idx_model_health_ledger_created_at ON model_health_ledger(created_at DESC);

-- Record migration
INSERT INTO applied_migrations (name, checksum, status, execution_time_ms)
VALUES ('121_model_health_ledger', md5('121_model_health_ledger'), 'success', 0)
ON CONFLICT (name) DO NOTHING;
