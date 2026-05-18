-- ============================================
-- Migration 014: Add Provenance Tracking
-- Date: 2026-05-18
-- Description: Add fingerprint versioning to prevent cascade reprocessing
-- ============================================

-- Add fingerprint_version to decision_lineage to track schema changes
ALTER TABLE decision_lineage
ADD COLUMN IF NOT EXISTS fingerprint_version VARCHAR(50),
ADD COLUMN IF NOT EXISTS created_at_epoch BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT;

-- Create index for fingerprint version tracking (detect drift)
CREATE INDEX IF NOT EXISTS idx_decision_lineage_fingerprint_version
  ON decision_lineage(fingerprint_version);

-- Update schema documentation comments in deterministic_signals JSONB:
-- Now includes: "signal_source": "DETERMINISTIC"
-- This tag indicates these are immutable Splunk facts, never LLM-derived

-- Update schema documentation comments in cognitive_signals JSONB:
-- Now includes: "signal_source": "AI"
-- This tag indicates these are LLM-enriched, versioned by model and prompt

-- Create view for governance quality metrics
CREATE OR REPLACE VIEW decision_quality_by_fingerprint_version AS
SELECT
  fingerprint_version,
  COUNT(*) as total_decisions,
  SUM(CASE WHEN decision_status = 'APPLIED' THEN 1 ELSE 0 END) as applied_count,
  SUM(CASE WHEN decision_status = 'DISMISSED' THEN 1 ELSE 0 END) as dismissed_count,
  ROUND(AVG((cognitive_signals->>'confidence_score')::NUMERIC), 2) as avg_confidence,
  MAX(created_at) as most_recent
FROM decision_lineage
WHERE fingerprint_version IS NOT NULL
GROUP BY fingerprint_version
ORDER BY created_at DESC;

-- Alert: detect fingerprint drift (when fingerprint_version changes mid-batch)
-- This indicates potential reprocessing cascade
CREATE OR REPLACE VIEW fingerprint_drift_detection AS
SELECT
  snapshot_id,
  COUNT(DISTINCT fingerprint_version) as version_count,
  ARRAY_AGG(DISTINCT fingerprint_version) as versions_in_snapshot,
  CASE
    WHEN COUNT(DISTINCT fingerprint_version) > 1 THEN 'DRIFT_DETECTED'
    ELSE 'STABLE'
  END as drift_status
FROM decision_lineage
GROUP BY snapshot_id
HAVING COUNT(DISTINCT fingerprint_version) > 1;
