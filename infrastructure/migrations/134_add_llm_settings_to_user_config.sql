-- Migration: Add LLM provider and API key fields to user_config
-- Purpose: Support tenant-specific LLM configurations securely

ALTER TABLE user_config ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(50) DEFAULT 'local';
ALTER TABLE user_config ADD COLUMN IF NOT EXISTS anthropic_api_key VARCHAR(255);
ALTER TABLE user_config ADD COLUMN IF NOT EXISTS anthropic_model VARCHAR(100);
