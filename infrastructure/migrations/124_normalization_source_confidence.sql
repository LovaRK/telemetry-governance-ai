-- P4.10: Source confidence tracking for normalization
-- Adds confidence column to normalization_variance for per-source-type
-- confidence scoring. Confidence = 1 - variance_pct/100, where variance_pct
-- is the KPI delta for a given source type. High confidence indicates stable,
-- reliable normalization for that source type.

ALTER TABLE normalization_variance
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,2);

ALTER TABLE normalization_variance
  ADD COLUMN IF NOT EXISTS entry_count INTEGER NOT NULL DEFAULT 0;

-- Index for per-source-type confidence queries
CREATE INDEX IF NOT EXISTS idx_norm_variance_source_confidence
  ON normalization_variance(source_type, created_at DESC);
