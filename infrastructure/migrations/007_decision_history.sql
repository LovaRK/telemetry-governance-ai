-- Migration 007: Decision History & Audit Trails
-- Stores snapshots of decisions over time to track recommendation changes
-- Enables audit trails for config changes and LLM prompt versions

CREATE TABLE IF NOT EXISTS decision_history (
    id                  SERIAL PRIMARY KEY,
    snapshot_id         INTEGER NOT NULL REFERENCES telemetry_snapshots(id) ON DELETE CASCADE,
    snapshot_date       DATE NOT NULL,
    index_name          VARCHAR(256) NOT NULL,
    tier_previous       VARCHAR(50),
    tier_current        VARCHAR(50) NOT NULL,
    action_previous     VARCHAR(50),
    action_current      VARCHAR(50) NOT NULL,
    confidence_changed  BOOLEAN DEFAULT FALSE,
    score_delta         NUMERIC(6, 2),
    change_reason       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_snapshot_date ON decision_history(snapshot_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_decision_index_name ON decision_history(index_name);
CREATE INDEX IF NOT EXISTS idx_decision_created_at ON decision_history(created_at);

CREATE TABLE IF NOT EXISTS config_audit_log (
    id                  SERIAL PRIMARY KEY,
    config_key          VARCHAR(100) NOT NULL REFERENCES user_config(config_key) ON DELETE CASCADE,
    change_type         VARCHAR(50) NOT NULL,
    old_value           JSONB,
    new_value           JSONB NOT NULL,
    changed_by          VARCHAR(256),
    change_reason       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_audit_key ON config_audit_log(config_key);
CREATE INDEX IF NOT EXISTS idx_config_audit_created_at ON config_audit_log(created_at);

CREATE TABLE IF NOT EXISTS llm_prompt_versions (
    id                  SERIAL PRIMARY KEY,
    version             INTEGER NOT NULL UNIQUE,
    prompt_template     TEXT NOT NULL,
    model_name          VARCHAR(100) NOT NULL DEFAULT 'gemma4:e4b',
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at        TIMESTAMPTZ
);

-- Insert initial prompt version (current)
INSERT INTO llm_prompt_versions (version, prompt_template, model_name, notes, activated_at)
VALUES (
    1,
    'You are a telemetry data analyst. Analyze the provided Splunk index metadata and classify each index into tiers (CRITICAL, IMPORTANT, NICE_TO_HAVE, LOW_VALUE) based on utilization, detection coverage, data quality, and cost. For each index, provide: tier, action (KEEP, OPTIMIZE, ARCHIVE, ELIMINATE, S3_CANDIDATE), confidence (0-1), and reasoning.',
    'gemma4:e4b',
    'Initial prompt version — tier classification and action assignment',
    NOW()
)
ON CONFLICT (version) DO NOTHING;

-- Grant permissions (adjust for your user)
-- GRANT SELECT, INSERT, UPDATE ON decision_history TO app_user;
-- GRANT SELECT, INSERT ON config_audit_log TO app_user;
-- GRANT SELECT ON llm_prompt_versions TO app_user;
