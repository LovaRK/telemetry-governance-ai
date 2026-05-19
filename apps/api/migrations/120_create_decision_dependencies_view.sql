-- Migration 120: Create Decision Dependencies View
-- Provides convenient queries for DAG traversal and decision lineage analysis

-- View 1: All dependencies for a decision (both parents and children)
CREATE OR REPLACE VIEW decision_dependencies AS
SELECT
  id,
  correlationId,
  parentDecisionId,
  childDecisionId,
  causalityType,
  confidence,
  reason,
  createdAt,
  updatedAt,
  'incoming' AS relationship_direction  -- Parent -> This decision
FROM governance_causality

UNION ALL

SELECT
  id,
  correlationId,
  childDecisionId AS parentDecisionId,
  parentDecisionId AS childDecisionId,
  causalityType,
  confidence,
  reason,
  createdAt,
  updatedAt,
  'outgoing' AS relationship_direction  -- This decision -> Child
FROM governance_causality;

-- View 2: Decision lineage (ancestors of a decision)
-- Shows all decisions that led to a specific decision
CREATE OR REPLACE VIEW decision_lineage AS
WITH RECURSIVE lineage AS (
  -- Base case: direct parents
  SELECT
    childDecisionId,
    parentDecisionId,
    causalityType,
    1 AS depth,
    ARRAY[childDecisionId, parentDecisionId] AS path
  FROM governance_causality

  UNION ALL

  -- Recursive case: parents of parents
  SELECT
    l.childDecisionId,
    gc.parentDecisionId,
    gc.causalityType,
    l.depth + 1,
    l.path || gc.parentDecisionId
  FROM lineage l
  JOIN governance_causality gc ON l.parentDecisionId = gc.childDecisionId
  WHERE l.depth < 10  -- Limit recursion depth to prevent infinite loops
    AND NOT gc.parentDecisionId = ANY(l.path)  -- Prevent cycles
)
SELECT
  childDecisionId AS decision_id,
  parentDecisionId AS ancestor_id,
  causalityType,
  depth,
  path
FROM lineage
ORDER BY childDecisionId, depth;

-- View 3: Decision impact (descendants of a decision)
-- Shows all decisions affected by a specific decision
CREATE OR REPLACE VIEW decision_impact AS
WITH RECURSIVE impact AS (
  -- Base case: direct children
  SELECT
    parentDecisionId,
    childDecisionId,
    causalityType,
    1 AS depth,
    ARRAY[parentDecisionId, childDecisionId] AS path
  FROM governance_causality

  UNION ALL

  -- Recursive case: children of children
  SELECT
    i.parentDecisionId,
    gc.childDecisionId,
    gc.causalityType,
    i.depth + 1,
    i.path || gc.childDecisionId
  FROM impact i
  JOIN governance_causality gc ON i.childDecisionId = gc.parentDecisionId
  WHERE i.depth < 10  -- Limit recursion depth
    AND NOT gc.childDecisionId = ANY(i.path)  -- Prevent cycles
)
SELECT
  parentDecisionId AS decision_id,
  childDecisionId AS descendant_id,
  causalityType,
  depth,
  path
FROM impact
ORDER BY parentDecisionId, depth;

-- View 4: Causality statistics per decision
CREATE OR REPLACE VIEW decision_causality_stats AS
SELECT
  d.id,
  d.indexName,
  COUNT(DISTINCT CASE WHEN gc.childDecisionId = d.id THEN gc.parentDecisionId END) AS incoming_dependencies,
  COUNT(DISTINCT CASE WHEN gc.parentDecisionId = d.id THEN gc.childDecisionId END) AS outgoing_dependencies,
  COUNT(DISTINCT gc.correlationId) AS unique_correlation_clusters,
  MAX(gc.createdAt) AS last_causality_recorded,
  AVG(gc.confidence) AS avg_confidence
FROM agent_decisions d
LEFT JOIN governance_causality gc ON d.id = gc.parentDecisionId OR d.id = gc.childDecisionId
GROUP BY d.id, d.indexName;

-- View 5: Correlation clusters (all decisions in a trace)
CREATE OR REPLACE VIEW correlation_clusters AS
SELECT
  gc.correlationId,
  COUNT(DISTINCT gc.parentDecisionId) + COUNT(DISTINCT gc.childDecisionId) AS decision_count,
  COUNT(*) AS causality_edges,
  MIN(gc.createdAt) AS cluster_start_time,
  MAX(gc.createdAt) AS cluster_end_time,
  ARRAY_AGG(DISTINCT gc.causalityType) AS relationship_types
FROM governance_causality gc
GROUP BY gc.correlationId;

-- Comments for documentation
COMMENT ON VIEW decision_dependencies IS 'Bidirectional view of all dependencies for a decision (both incoming parents and outgoing children)';
COMMENT ON VIEW decision_lineage IS 'Recursive view showing all ancestors of a decision (used for root cause analysis)';
COMMENT ON VIEW decision_impact IS 'Recursive view showing all descendants of a decision (used for impact analysis)';
COMMENT ON VIEW decision_causality_stats IS 'Statistics on causality for each decision (dependency count, correlation clusters, confidence)';
COMMENT ON VIEW correlation_clusters IS 'Groups decisions by correlation ID (trace ID) for viewing related operations across async boundaries';
