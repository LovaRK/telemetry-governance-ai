-- Migration 120: Create queue_health_metrics table for reanalysis queue monitoring
-- Date: 2026-05-20
-- Purpose: Track queue health metrics including depth, processing latency, decision stability
-- Related to: /api/queue-health endpoint, ReanalysisQueueTab component

CREATE TABLE IF NOT EXISTS queue_health_metrics (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  snapshot_id VARCHAR(255) NOT NULL UNIQUE,
  reuse_ratio NUMERIC(5, 4) DEFAULT 0.0,
  unchanged_indexes INTEGER DEFAULT 0,
  total_indexes INTEGER DEFAULT 0,
  queue_depth INTEGER DEFAULT 0,
  queue_depth_max_observed INTEGER DEFAULT 0,
  processing_time_p95_ms INTEGER DEFAULT 0,
  decision_flip_rate NUMERIC(5, 4) DEFAULT 0.0,
  flip_count INTEGER DEFAULT 0,
  unstable_decisions INTEGER DEFAULT 0,
  candidates_sent_to_ai INTEGER DEFAULT 0,
  filtering_efficiency_pct NUMERIC(5, 2) DEFAULT 0.0,
  avg_inference_latency_ms NUMERIC(8, 2) DEFAULT 0.0,
  worker_memory_peak_mb INTEGER DEFAULT 0,
  worker_count_active INTEGER DEFAULT 0,
  high_confidence_proposals INTEGER DEFAULT 0,
  medium_confidence_proposals INTEGER DEFAULT 0,
  low_confidence_proposals INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_health_metrics_snapshot_date ON queue_health_metrics(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_queue_health_metrics_created_at ON queue_health_metrics(created_at DESC);

-- Record migration
INSERT INTO applied_migrations (name, checksum, status, execution_time_ms)
VALUES ('120_queue_health_metrics', md5('120_queue_health_metrics'), 'success', 0)
ON CONFLICT (name) DO NOTHING;
