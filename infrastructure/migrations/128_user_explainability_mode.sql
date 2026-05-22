BEGIN;

ALTER TABLE user_config
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS explainability_mode BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_config_tenant_user
  ON user_config (tenant_id, user_id);

COMMIT;
