-- 203_splunk_endpoint_separation
-- Separates the single splunk_url into API, HEC, and MCP endpoints
-- Adds encrypted REST auth secret storage with versioning

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS splunk_api_url VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS splunk_hec_url VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS splunk_mcp_url VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS splunk_rest_auth_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS splunk_rest_auth_secret TEXT,
  ADD COLUMN IF NOT EXISTS splunk_rest_auth_secret_version INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS splunk_rest_auth_updated_at TIMESTAMPTZ;

-- Backfill: intelligently swap ports based on convention (8088 ↔ 8089)
UPDATE tenants
SET
  splunk_api_url = CASE
    WHEN splunk_url LIKE '%:8088%' THEN regexp_replace(splunk_url, ':8088', ':8089')
    ELSE splunk_url
  END,
  splunk_hec_url = CASE
    WHEN splunk_url LIKE '%:8089%' THEN regexp_replace(splunk_url, ':8089', ':8088')
    ELSE splunk_url
  END,
  splunk_mcp_url = CASE
    WHEN splunk_url LIKE '%:8089%' THEN regexp_replace(splunk_url, ':8089', ':8089') || '/services/mcp'
    ELSE splunk_url || '/services/mcp'
  END
WHERE splunk_url IS NOT NULL;
