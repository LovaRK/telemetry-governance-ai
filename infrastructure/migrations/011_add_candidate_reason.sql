-- ============================================
-- Migration 011: Add Candidate Reason Tracking
-- Date: 2026-05-17
-- Description: Add candidate_reason field to track why indexes were selected for LLM processing
-- ============================================

ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS candidate_reason TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_agent_decisions_reason ON agent_decisions USING GIN (candidate_reason);
