-- ============================================
-- Migration 022: Prompt Version Governance & Invalidation Semantics
-- Date: 2026-05-18
-- Description: Define when prompt changes require reanalysis vs when they're safe
-- ============================================

-- Prompt version policy: declare semantic impact of each prompt change
CREATE TABLE IF NOT EXISTS prompt_version_policy (
    policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA256 of prompt text
    version_string VARCHAR(20) NOT NULL,     -- e.g., 'v2.1-compliance'
    model_version VARCHAR(50) NOT NULL,      -- e.g., 'gemma2:9b'

    -- Semantic impact classification
    change_type VARCHAR(50) NOT NULL, -- 'TYPO_FIX', 'SCORING_ADJUSTMENT', 'REASONING_RUBRIC', 'GOVERNANCE_POLICY', 'SYSTEM_PROMPT'
    is_breaking_change BOOLEAN NOT NULL DEFAULT FALSE,

    -- Reanalysis requirements
    requires_reanalysis BOOLEAN NOT NULL DEFAULT FALSE,
    forces_full_reanalysis BOOLEAN NOT NULL DEFAULT FALSE, -- If TRUE, entire corpus must be reprocessed

    -- Confidence impact
    confidence_reset_factor NUMERIC(3, 2) NOT NULL DEFAULT 1.00, -- Multiplier applied to all decisions made with this version
    confidence_reset_required BOOLEAN NOT NULL DEFAULT FALSE,

    -- Rollback behavior
    is_deprecated BOOLEAN NOT NULL DEFAULT FALSE,
    deprecated_at TIMESTAMPTZ,
    replacement_prompt_hash VARCHAR(64), -- Points to the next version

    -- Change description for audit trail
    changelog_entry TEXT,
    change_rationale TEXT,
    approved_by UUID,
    approved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prompt_hash ON prompt_version_policy(prompt_hash);
CREATE INDEX idx_prompt_version_string ON prompt_version_policy(version_string DESC);
CREATE INDEX idx_prompt_breaking_change ON prompt_version_policy(is_breaking_change);
CREATE INDEX idx_prompt_requires_reanalysis ON prompt_version_policy(requires_reanalysis);
CREATE INDEX idx_prompt_deprecated ON prompt_version_policy(is_deprecated);

CREATE TRIGGER update_prompt_version_policy_updated_at
    BEFORE UPDATE ON prompt_version_policy
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Prompt change classification matrix: guidance for when to trigger reanalysis
CREATE TABLE IF NOT EXISTS prompt_change_classification_matrix (
    matrix_id SERIAL PRIMARY KEY,
    change_type VARCHAR(50) NOT NULL UNIQUE,
    requires_reanalysis BOOLEAN NOT NULL,
    forces_full_reanalysis BOOLEAN NOT NULL,
    confidence_reset_factor NUMERIC(3, 2) NOT NULL,
    queue_priority VARCHAR(20) NOT NULL, -- EMERGENCY, CRITICAL, STANDARD, DEFERRED
    description TEXT,
    example TEXT
);

-- Examples of prompt changes and their impact
INSERT INTO prompt_change_classification_matrix (change_type, requires_reanalysis, forces_full_reanalysis, confidence_reset_factor, queue_priority, description, example) VALUES
    ('TYPO_FIX',           FALSE, FALSE, 1.00, 'DEFERRED',    'Grammar/spelling fix only',                         'Fixed: "utilization pct" → "utilization %"'),
    ('FORMATTING',         FALSE, FALSE, 1.00, 'DEFERRED',    'Whitespace or template restructure',                 'Added line breaks for readability'),
    ('EXAMPLE_UPDATE',     FALSE, FALSE, 0.95, 'BACKGROUND',  'Updated examples but not scoring logic',             'Changed example index name'),
    ('SCORING_ADJUSTMENT', TRUE,  FALSE, 0.85, 'STANDARD',    'Modified confidence or score calculation',           'Changed weight: utilization 0.2 → 0.3'),
    ('REASONING_RUBRIC',   TRUE,  FALSE, 0.75, 'STANDARD',    'Changed decision rationale or classification rules', 'Added "stale index" category'),
    ('GOVERNANCE_POLICY',  TRUE,  TRUE,  0.50, 'CRITICAL',    'New compliance/governance constraint',               'Added: LEGAL_HOLD blocks archival'),
    ('SYSTEM_PROMPT',      TRUE,  TRUE,  0.25, 'EMERGENCY',   'Core reasoning paradigm changed',                    'Changed from rule-based to ML-driven scoring'),
    ('ROLLBACK',           TRUE,  FALSE, 1.00, 'CRITICAL',    'Reverting to previous prompt version',               'Rolled back from v2.1 to v2.0')
ON CONFLICT DO NOTHING;

-- Prompt deployment ledger: track when versions go live
CREATE TABLE IF NOT EXISTS prompt_deployment_ledger (
    deployment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_hash VARCHAR(64) NOT NULL REFERENCES prompt_version_policy(prompt_hash) ON DELETE CASCADE,
    version_string VARCHAR(20) NOT NULL,

    -- Deployment metadata
    deployed_by UUID NOT NULL,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    environment VARCHAR(50) NOT NULL, -- 'staging', 'production'

    -- Reanalysis queue impact
    triggered_reanalysis_count INTEGER DEFAULT 0,
    reanalysis_jobs_queued_at TIMESTAMPTZ,
    reanalysis_budget_allocated INTEGER,

    -- Rollout metrics
    decisions_using_version INTEGER NOT NULL DEFAULT 0,
    avg_confidence_change NUMERIC(5, 2),
    approval_rate_change_pct NUMERIC(5, 2),

    -- Safety metrics
    critical_errors_detected INTEGER DEFAULT 0,
    rollback_triggered BOOLEAN DEFAULT FALSE,
    rollback_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deployment_prompt_hash ON prompt_deployment_ledger(prompt_hash);
CREATE INDEX idx_deployment_version ON prompt_deployment_ledger(version_string);
CREATE INDEX idx_deployment_deployed_at ON prompt_deployment_ledger(deployed_at DESC);
CREATE INDEX idx_deployment_environment ON prompt_deployment_ledger(environment);

-- Ground truth sampling schedule: automated 5% random review of stable decisions
CREATE TABLE IF NOT EXISTS ground_truth_sampling_schedule (
    sampling_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Sampling window
    sampling_week_start DATE NOT NULL,
    sampling_week_end DATE NOT NULL,

    -- Sampling parameters
    total_stable_decisions_available INTEGER NOT NULL,
    sample_size_5pct INTEGER NOT NULL, -- Number of decisions to review (5% of corpus)

    -- Sampling state
    sampling_status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED
    sampling_initiated_at TIMESTAMPTZ,
    sampling_completed_at TIMESTAMPTZ,

    -- Results
    decisions_reviewed INTEGER DEFAULT 0,
    hallucinations_detected INTEGER DEFAULT 0,
    false_positives_found INTEGER DEFAULT 0,
    accuracy_rate_pct NUMERIC(5, 2),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sampling_status ON ground_truth_sampling_schedule(sampling_status);
CREATE INDEX idx_sampling_week ON ground_truth_sampling_schedule(sampling_week_start DESC);

-- Ground truth finding ledger: track specific hallucinations discovered during sampling
CREATE TABLE IF NOT EXISTS ground_truth_findings (
    finding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sampling_id UUID NOT NULL REFERENCES ground_truth_sampling_schedule(sampling_id) ON DELETE CASCADE,
    index_name VARCHAR(200) NOT NULL,

    -- Decision that was reviewed
    decision_id UUID NOT NULL REFERENCES agent_decisions(snapshot_id) ON DELETE CASCADE,

    -- Finding classification
    finding_type VARCHAR(50) NOT NULL, -- 'HALLUCINATION', 'FALSE_POSITIVE', 'CORRECT_BUT_UNCERTAIN'
    finding_description TEXT NOT NULL,

    -- Impact assessment
    confidence_was_high BOOLEAN NOT NULL,
    approval_status_before_finding VARCHAR(30),

    -- Remediation
    remediation_action TEXT,
    remediation_triggered_reanalysis BOOLEAN DEFAULT FALSE,

    -- Expert review
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    expert_conclusion TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_findings_sampling_id ON ground_truth_findings(sampling_id);
CREATE INDEX idx_findings_index_name ON ground_truth_findings(index_name);
CREATE INDEX idx_findings_type ON ground_truth_findings(finding_type);
CREATE INDEX idx_findings_confidence_was_high ON ground_truth_findings(confidence_was_high);
