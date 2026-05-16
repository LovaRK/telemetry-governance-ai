-- ============================================
-- Migration 006: User Configuration Table
-- Date: 2026-05-16
-- Description: Create user_config table for storing user-configurable cost model and decision weights
-- ============================================

-- User Configuration (cost model, weights, retention policies)
CREATE TABLE IF NOT EXISTS user_config (
    id                  SERIAL PRIMARY KEY,
    config_key          VARCHAR(100) NOT NULL UNIQUE DEFAULT 'default',
    cost_per_gb_per_day DECIMAL(8,2) NOT NULL DEFAULT 0.50,
    max_retention_days  INTEGER NOT NULL DEFAULT 730,
    max_parallel        INTEGER NOT NULL DEFAULT 2,
    decision_weights    JSONB NOT NULL DEFAULT '{}',
    retention_policy    JSONB NOT NULL DEFAULT '{"CRITICAL": 730, "IMPORTANT": 365, "NICE_TO_HAVE": 90, "LOW_VALUE": 30}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default config if not exists
INSERT INTO user_config (config_key, cost_per_gb_per_day, max_retention_days, max_parallel)
VALUES ('default', 0.50, 730, 2)
ON CONFLICT (config_key) DO NOTHING;

CREATE TRIGGER update_user_config_updated_at
    BEFORE UPDATE ON user_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
