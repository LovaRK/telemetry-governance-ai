-- Migration 119: Create Governance Causality Tracking Table
-- Enables distributed tracing and decision dependency analysis

CREATE TABLE governance_causality (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Correlation ID for distributed tracing
  correlationId VARCHAR(100) NOT NULL,

  -- Decision IDs forming the causal relationship
  parentDecisionId UUID NOT NULL REFERENCES agent_decisions(id) ON DELETE CASCADE,
  childDecisionId UUID NOT NULL REFERENCES agent_decisions(id) ON DELETE CASCADE,

  -- Type of causal relationship
  causalityType VARCHAR(50) NOT NULL CHECK (
    causalityType IN ('blocks', 'depends_on', 'overrides', 'triggers', 'contradicts', 'related')
  ),

  -- Confidence in the causal link (0.0 = uncertain, 1.0 = definite)
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- Optional: reason for the causal relationship
  reason TEXT,

  -- Timestamps
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Prevent self-referential relationships
  CONSTRAINT no_self_reference CHECK (parentDecisionId != childDecisionId),

  -- Unique constraint per decision pair (no duplicate relationships)
  CONSTRAINT unique_causal_link UNIQUE (parentDecisionId, childDecisionId)
);

-- Indexes for efficient querying
CREATE INDEX idx_governance_causality_parent ON governance_causality(parentDecisionId);
CREATE INDEX idx_governance_causality_child ON governance_causality(childDecisionId);
CREATE INDEX idx_governance_causality_correlation ON governance_causality(correlationId);
CREATE INDEX idx_governance_causality_type ON governance_causality(causalityType);
CREATE INDEX idx_governance_causality_created ON governance_causality(createdAt DESC);

-- Composite index for common queries
CREATE INDEX idx_governance_causality_parent_type ON governance_causality(parentDecisionId, causalityType);
CREATE INDEX idx_governance_causality_child_type ON governance_causality(childDecisionId, causalityType);

-- Comments for documentation
COMMENT ON TABLE governance_causality IS 'Tracks causal relationships between governance decisions for distributed tracing and dependency analysis';
COMMENT ON COLUMN governance_causality.correlationId IS 'Distributed trace ID linking related operations';
COMMENT ON COLUMN governance_causality.causalityType IS 'Type of causal relationship: blocks (parent blocks child), depends_on (child depends on parent), overrides, triggers, contradicts, or related';
COMMENT ON COLUMN governance_causality.confidence IS 'Confidence in the causal relationship; 1.0 = definite, 0.5 = probable, 0.0 = speculative';
