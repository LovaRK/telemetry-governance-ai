-- ============================================
-- Migration 021: Advanced Governance Workflow States
-- Date: 2026-05-18
-- Description: Replace binary APPROVED/REJECTED with sophisticated review lifecycle
-- ============================================

-- Extended governance workflow state machine
CREATE TYPE governance_workflow_state AS ENUM (
    'PROPOSED',              -- Initial AI decision, awaiting review
    'APPROVED',              -- Human approved, trusted
    'REJECTED',              -- Human rejected, decision invalid
    'ESCALATED',             -- Requires expert human review
    'CONDITIONAL',           -- Approved with caveats/constraints
    'EXPIRED',               -- Approval window exceeded (90 days)
    'SUPERSEDED',            -- Replaced by newer decision
    'UNDER_INVESTIGATION',   -- Temporarily frozen for audit
    'QUARANTINED'            -- Blacklisted due to repeated failures
);

-- Caveat type for conditional approvals
CREATE TYPE approval_caveat_type AS ENUM (
    'REQUIRES_RETENTION_REVIEW',    -- Requires compliance review
    'HIGH_VARIANCE_DECISION',       -- Decision confidence unstable
    'TEMPORARY_OVERRIDE',           -- Valid only until date X
    'BUSINESS_CONTEXT_REQUIRED',    -- Requires business rule application
    'SECURITY_REVIEW_PENDING',      -- Awaits security team sign-off
    'POLICY_EXCEPTION',             -- Conflicts with governance policy
    'COST_THRESHOLD_EXCEEDED'       -- Savings > cost threshold
);

-- Augment human_review_ledger with advanced workflow
ALTER TABLE human_review_ledger
ADD COLUMN IF NOT EXISTS workflow_state governance_workflow_state DEFAULT 'PROPOSED',
ADD COLUMN IF NOT EXISTS caveat_type approval_caveat_type,
ADD COLUMN IF NOT EXISTS caveat_description TEXT,
ADD COLUMN IF NOT EXISTS caveat_valid_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
ADD COLUMN IF NOT EXISTS escalation_assigned_to UUID,
ADD COLUMN IF NOT EXISTS investigation_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS investigation_opened_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS investigation_closed_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for workflow state lookups
CREATE INDEX IF NOT EXISTS idx_review_workflow_state ON human_review_ledger(workflow_state);
CREATE INDEX IF NOT EXISTS idx_review_escalated ON human_review_ledger(workflow_state) WHERE workflow_state = 'ESCALATED';
CREATE INDEX IF NOT EXISTS idx_review_conditional ON human_review_ledger(workflow_state, caveat_valid_until)
    WHERE workflow_state = 'CONDITIONAL';
CREATE INDEX IF NOT EXISTS idx_review_under_investigation ON human_review_ledger(workflow_state)
    WHERE workflow_state = 'UNDER_INVESTIGATION';

-- Workflow transition audit log
CREATE TABLE IF NOT EXISTS governance_workflow_transitions (
    transition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES human_review_ledger(review_id) ON DELETE CASCADE,
    index_name VARCHAR(200) NOT NULL,

    -- State machine
    from_state governance_workflow_state NOT NULL,
    to_state governance_workflow_state NOT NULL,
    transition_reason TEXT,

    -- Who made the transition
    transitioned_by UUID NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Caveat changes (if CONDITIONAL)
    new_caveat_type approval_caveat_type,
    new_caveat_valid_until TIMESTAMP WITH TIME ZONE,

    -- Governance context
    is_automatic_transition BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE if system-triggered (e.g., EXPIRED)

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transitions_review_id ON governance_workflow_transitions(review_id);
CREATE INDEX idx_transitions_index_name ON governance_workflow_transitions(index_name);
CREATE INDEX idx_transitions_from_state ON governance_workflow_transitions(from_state);
CREATE INDEX idx_transitions_to_state ON governance_workflow_transitions(to_state);
CREATE INDEX idx_transitions_transitioned_at ON governance_workflow_transitions(transitioned_at DESC);

-- Conditional approval registry: track caveats and their validity windows
CREATE TABLE IF NOT EXISTS conditional_approval_registry (
    caveat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES human_review_ledger(review_id) ON DELETE CASCADE,
    index_name VARCHAR(200) NOT NULL,

    -- Caveat definition
    caveat_type approval_caveat_type NOT NULL,
    caveat_description TEXT NOT NULL,
    caveat_severity VARCHAR(30) NOT NULL, -- 'INFO', 'WARNING', 'CRITICAL'

    -- Validity window
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Caveat resolution
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_caveat_review_id ON conditional_approval_registry(review_id);
CREATE INDEX idx_caveat_index_name ON conditional_approval_registry(index_name);
CREATE INDEX idx_caveat_type ON conditional_approval_registry(caveat_type);
CREATE INDEX idx_caveat_active ON conditional_approval_registry(is_active);
CREATE INDEX idx_caveat_valid_until ON conditional_approval_registry(valid_until) WHERE is_active = TRUE;

-- Investigation ledger: track when decisions are flagged for audit
CREATE TABLE IF NOT EXISTS governance_investigation_ledger (
    investigation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES human_review_ledger(review_id) ON DELETE CASCADE,
    index_name VARCHAR(200) NOT NULL,

    -- Investigation context
    investigation_reason TEXT NOT NULL,
    investigation_initiated_by UUID NOT NULL,
    investigation_initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Investigation state
    investigation_status VARCHAR(50) NOT NULL DEFAULT 'OPEN', -- OPEN, IN_PROGRESS, RESOLVED, CLOSED
    assigned_to UUID,
    assigned_at TIMESTAMPTZ,

    -- Investigation findings
    findings TEXT,
    findings_severity VARCHAR(30), -- 'NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    conclusion VARCHAR(200),

    -- Resolution
    investigation_closed_at TIMESTAMPTZ,
    closed_by UUID,
    action_taken TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investigation_review_id ON governance_investigation_ledger(review_id);
CREATE INDEX idx_investigation_index_name ON governance_investigation_ledger(index_name);
CREATE INDEX idx_investigation_status ON governance_investigation_ledger(investigation_status);
CREATE INDEX idx_investigation_initiated_at ON governance_investigation_ledger(investigation_initiated_at DESC);

CREATE TRIGGER update_governance_investigation_ledger_updated_at
    BEFORE UPDATE ON governance_investigation_ledger
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Workflow state transition rules: define valid state paths
CREATE TABLE IF NOT EXISTS workflow_state_transition_rules (
    rule_id SERIAL PRIMARY KEY,
    from_state governance_workflow_state NOT NULL,
    to_state governance_workflow_state NOT NULL,
    requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
    requires_escalation_approval BOOLEAN NOT NULL DEFAULT FALSE,
    allows_caveat_type approval_caveat_type,
    description TEXT
);

-- Valid state transitions
INSERT INTO workflow_state_transition_rules (from_state, to_state, requires_reason, requires_escalation_approval, description) VALUES
    ('PROPOSED', 'APPROVED', FALSE, FALSE, 'Basic approval'),
    ('PROPOSED', 'REJECTED', TRUE, FALSE, 'Rejection with reason'),
    ('PROPOSED', 'ESCALATED', TRUE, FALSE, 'Escalate for expert review'),
    ('PROPOSED', 'CONDITIONAL', TRUE, FALSE, 'Conditional approval'),
    ('APPROVED', 'EXPIRED', TRUE, FALSE, 'Auto-transition: 90-day expiry'),
    ('APPROVED', 'UNDER_INVESTIGATION', TRUE, TRUE, 'Audit trigger'),
    ('CONDITIONAL', 'APPROVED', FALSE, FALSE, 'Caveat resolved, fully approved'),
    ('CONDITIONAL', 'EXPIRED', TRUE, FALSE, 'Caveat expired'),
    ('ESCALATED', 'APPROVED', TRUE, FALSE, 'Expert approved'),
    ('ESCALATED', 'REJECTED', TRUE, FALSE, 'Expert rejected'),
    ('ESCALATED', 'CONDITIONAL', TRUE, FALSE, 'Expert conditional approval'),
    ('UNDER_INVESTIGATION', 'APPROVED', TRUE, FALSE, 'Investigation cleared'),
    ('UNDER_INVESTIGATION', 'QUARANTINED', TRUE, FALSE, 'Investigation revealed fraud')
ON CONFLICT DO NOTHING;
