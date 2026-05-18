-- ============================================================
-- Migration 101_confidence_recovery_calibration.sql
-- Confidence Recovery Model: Bidirectional Trust Calibration
-- Date: 2026-05-18
-- ============================================================
-- Adds persistent recovery tracking to enable trust rebuilding
-- instead of monotonic decay toward zero.

-- ============================================================
-- 1. RECOVERY TRACKING (Index Rolling Baselines Enhancement)
-- ============================================================
-- Adds recovery score and stability metrics for bidirectional
-- confidence calculation (decay + recovery, not just decay)

ALTER TABLE IF EXISTS index_rolling_baselines
ADD COLUMN IF NOT EXISTS recovery_score NUMERIC(3, 2) NOT NULL DEFAULT 0.00 CHECK (recovery_score >= 0.00 AND recovery_score <= 1.00),
ADD COLUMN IF NOT EXISTS consecutive_stable_days INT NOT NULL DEFAULT 0 CHECK (consecutive_stable_days >= 0),
ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Index for rapid recovery milestone lookups
CREATE INDEX IF NOT EXISTS idx_baselines_recovery_score ON index_rolling_baselines(recovery_score DESC);
CREATE INDEX IF NOT EXISTS idx_baselines_stable_days ON index_rolling_baselines(consecutive_stable_days DESC);

-- ============================================================
-- 2. CONFIDENCE CALIBRATION LOG (Audit Trail for Trust Changes)
-- ============================================================
-- Immutable record of every confidence calculation decision
-- for forensic analysis of trust degradation/recovery patterns

CREATE TABLE IF NOT EXISTS confidence_calibration_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,

    -- Input components
    base_confidence NUMERIC(3, 2) NOT NULL CHECK (base_confidence >= 0 AND base_confidence <= 1),
    drift_penalty NUMERIC(3, 2) NOT NULL CHECK (drift_penalty >= 0 AND drift_penalty <= 1),
    temporal_decay NUMERIC(3, 2) NOT NULL CHECK (temporal_decay >= 0 AND temporal_decay <= 1),
    recovery_score NUMERIC(3, 2) NOT NULL CHECK (recovery_score >= 0 AND recovery_score <= 1),
    approval_state VARCHAR(50) NOT NULL CHECK (approval_state IN ('APPROVED', 'CONDITIONAL', 'PROPOSED', 'REJECTED')),
    consecutive_stable_days INT NOT NULL CHECK (consecutive_stable_days >= 0),

    -- Calculation results
    raw_effective NUMERIC(3, 2) NOT NULL,
    governance_cap NUMERIC(3, 2) NOT NULL,
    final_effective NUMERIC(3, 2) NOT NULL CHECK (final_effective >= 0 AND final_effective <= 1),
    is_capped BOOLEAN NOT NULL,
    confidence_band VARCHAR(20) NOT NULL CHECK (confidence_band IN ('UNRELIABLE', 'CAUTION', 'RELIABLE', 'TRUSTED')),

    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calibration_log_index_name ON confidence_calibration_log(index_name);
CREATE INDEX IF NOT EXISTS idx_calibration_log_approval ON confidence_calibration_log(approval_state);
CREATE INDEX IF NOT EXISTS idx_calibration_log_band ON confidence_calibration_log(confidence_band);

-- ============================================================
-- 3. RECOVERY MILESTONE TRACKING (Governance Milestones)
-- ============================================================
-- Immutable ledger of when recovery milestones were achieved
-- (7d stable → +0.10, 14d → +0.20, 30d → +0.40, etc.)

CREATE TABLE IF NOT EXISTS recovery_milestones (
    milestone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(255) NOT NULL,

    -- Milestone achieved
    milestone_type VARCHAR(50) NOT NULL CHECK (
        milestone_type IN ('STABLE_7_DAYS', 'STABLE_14_DAYS', 'STABLE_30_DAYS', 'APPROVED_30_DAYS', 'REUSED_3_PLUS')
    ),
    recovery_points NUMERIC(3, 2) NOT NULL CHECK (recovery_points > 0),

    -- When achieved
    achieved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Governance metadata
    triggered_by VARCHAR(100) NOT NULL,  -- 'confidence_recovery_service', 'human_review', etc.
    confidence_before NUMERIC(3, 2),
    confidence_after NUMERIC(3, 2)
);

CREATE INDEX IF NOT EXISTS idx_milestones_index_name ON recovery_milestones(index_name);
CREATE INDEX IF NOT EXISTS idx_milestones_type ON recovery_milestones(milestone_type);

-- ============================================================
-- 4. TRUST BANDS VIEW (Operational Trust Categories)
-- ============================================================
-- Maps numerical confidence into actionable operational bands

CREATE OR REPLACE VIEW confidence_bands_reference AS
SELECT
    'UNRELIABLE' as band_name,
    0.00 as min_threshold,
    0.29 as max_threshold,
    'Active semantic drift or blacklisted state' as operational_meaning,
    'Automatically freezes cache inheritance; forces immediate reanalysis' as control_plane_behavior
UNION ALL
SELECT
    'CAUTION',
    0.30,
    0.59,
    'Experiencing mild metric drift or baseline decay',
    'Flags warnings inside inspection log; entry priority rises in audit queues'
UNION ALL
SELECT
    'RELIABLE',
    0.60,
    0.84,
    'Recovering or unreviewed but highly consistent',
    'Stable state; allowed to auto-recycle fingerprints without triggering manual alerts'
UNION ALL
SELECT
    'TRUSTED',
    0.85,
    0.95,
    'Verified, highly stable baseline',
    'Bypasses standard daily drift loops; evaluated on low-priority weekly track'
ORDER BY min_threshold;

-- ============================================================
-- 5. BIDIRECTIONAL CONFIDENCE COMPUTATION VIEW
-- ============================================================
-- Weighted additive blend model:
-- C_eff = ((base × approval × 0.6) + (recovery × 0.4)) × drift × decay
--
-- Why: Additive blend allows recovery to restore confidence even after strong drift
-- (Multiplicative formulas trap degraded systems in the basement)

CREATE OR REPLACE VIEW bidirectional_confidence_analysis AS
SELECT
    f.index_name,
    f.calculated_monthly_loss_usd AS provable_loss_usd,
    e.confidence_score AS base_confidence,
    d.drift_severity AS drift_status,
    d.confidence_penalty_applied AS drift_penalty,
    r.review_action AS human_review_status,
    b.consecutive_stable_days,
    b.recovery_score,

    -- Recovery factor based on stability window (7d +0.10, 14d +0.20, 30d +0.40)
    CASE
        WHEN b.consecutive_stable_days >= 30 THEN
            CASE WHEN r.review_action = 'APPROVED' THEN 0.60 ELSE 0.40 END
        WHEN b.consecutive_stable_days >= 14 THEN 0.20
        WHEN b.consecutive_stable_days >= 7 THEN 0.10
        ELSE 0.00
    END AS calculated_recovery_factor,

    -- Approval multiplier
    CASE WHEN r.review_action = 'APPROVED' THEN 1.00
         WHEN r.review_action = 'REJECTED' THEN 0.0
         ELSE 0.5
    END AS approval_multiplier,

    -- Weighted additive blend: ((base × approval × 0.6) + (recovery × 0.4))
    ROUND(
        (
            (e.confidence_score *
             CASE WHEN r.review_action = 'APPROVED' THEN 1.00
                  WHEN r.review_action = 'REJECTED' THEN 0.0
                  ELSE 0.5
             END *
             0.6) +
            (CASE
                WHEN b.consecutive_stable_days >= 30 THEN
                    CASE WHEN r.review_action = 'APPROVED' THEN 0.60 ELSE 0.40 END
                WHEN b.consecutive_stable_days >= 14 THEN 0.20
                WHEN b.consecutive_stable_days >= 7 THEN 0.10
                ELSE 0.00
            END * 0.4)
        ),
        2
    ) AS blended_trust,

    -- Raw bidirectional score: blended_trust × drift × decay
    ROUND(
        (
            (e.confidence_score *
             CASE WHEN r.review_action = 'APPROVED' THEN 1.00
                  WHEN r.review_action = 'REJECTED' THEN 0.0
                  ELSE 0.5
             END *
             0.6) +
            (CASE
                WHEN b.consecutive_stable_days >= 30 THEN
                    CASE WHEN r.review_action = 'APPROVED' THEN 0.60 ELSE 0.40 END
                WHEN b.consecutive_stable_days >= 14 THEN 0.20
                WHEN b.consecutive_stable_days >= 7 THEN 0.10
                ELSE 0.00
            END * 0.4)
        ) *
        d.confidence_penalty_applied,
        2
    ) AS raw_bidirectional_score,

    -- Governance cap based on approval state
    CASE WHEN r.review_action = 'APPROVED' THEN 0.95
         WHEN r.review_action = 'CONDITIONAL' THEN 0.75
         WHEN r.review_action = 'REJECTED' THEN 0.00
         ELSE 0.50
    END AS governance_cap,

    -- Final capped score
    ROUND(
        LEAST(
            GREATEST(
                (
                    (e.confidence_score *
                     CASE WHEN r.review_action = 'APPROVED' THEN 1.00
                          WHEN r.review_action = 'REJECTED' THEN 0.0
                          ELSE 0.5
                     END *
                     0.6) +
                    (CASE
                        WHEN b.consecutive_stable_days >= 30 THEN
                            CASE WHEN r.review_action = 'APPROVED' THEN 0.60 ELSE 0.40 END
                        WHEN b.consecutive_stable_days >= 14 THEN 0.20
                        WHEN b.consecutive_stable_days >= 7 THEN 0.10
                        ELSE 0.00
                    END * 0.4)
                ) *
                d.confidence_penalty_applied,
                0.00
            ),
            CASE WHEN r.review_action = 'APPROVED' THEN 0.95
                 WHEN r.review_action = 'CONDITIONAL' THEN 0.75
                 WHEN r.review_action = 'REJECTED' THEN 0.00
                 ELSE 0.50
            END
        ),
        2
    ) AS final_effective_confidence,

    -- Operational trust band
    CASE
        WHEN ROUND(
            LEAST(
                GREATEST(
                    (
                        (e.confidence_score *
                         CASE WHEN r.review_action = 'APPROVED' THEN 1.00
                              WHEN r.review_action = 'REJECTED' THEN 0.0
                              ELSE 0.5
                         END *
                         0.6) +
                        (CASE
                            WHEN b.consecutive_stable_days >= 30 THEN
                                CASE WHEN r.review_action = 'APPROVED' THEN 0.60 ELSE 0.40 END
                            WHEN b.consecutive_stable_days >= 14 THEN 0.20
                            WHEN b.consecutive_stable_days >= 7 THEN 0.10
                            ELSE 0.00
                        END * 0.4)
                    ) *
                    d.confidence_penalty_applied,
                    0.00
                ),
                CASE WHEN r.review_action = 'APPROVED' THEN 0.95
                     WHEN r.review_action = 'CONDITIONAL' THEN 0.75
                     WHEN r.review_action = 'REJECTED' THEN 0.00
                     ELSE 0.50
                END
            ),
            2
        ) >= 0.85 THEN 'TRUSTED'
        WHEN ROUND(
            LEAST(
                GREATEST(
                    (
                        (e.confidence_score *
                         CASE WHEN r.review_action = 'APPROVED' THEN 1.00
                              WHEN r.review_action = 'REJECTED' THEN 0.0
                              ELSE 0.5
                         END *
                         0.6) +
                        (CASE
                            WHEN b.consecutive_stable_days >= 30 THEN
                                CASE WHEN r.review_action = 'APPROVED' THEN 0.60 ELSE 0.40 END
                            WHEN b.consecutive_stable_days >= 14 THEN 0.20
                            WHEN b.consecutive_stable_days >= 7 THEN 0.10
                            ELSE 0.00
                        END * 0.4)
                    ) *
                    d.confidence_penalty_applied,
                    0.00
                ),
                CASE WHEN r.review_action = 'APPROVED' THEN 0.95
                     WHEN r.review_action = 'CONDITIONAL' THEN 0.75
                     WHEN r.review_action = 'REJECTED' THEN 0.00
                     ELSE 0.50
                END
            ),
            2
        ) >= 0.60 THEN 'RELIABLE'
        WHEN ROUND(
            LEAST(
                GREATEST(
                    (
                        (e.confidence_score *
                         CASE WHEN r.review_action = 'APPROVED' THEN 1.00
                              WHEN r.review_action = 'REJECTED' THEN 0.0
                              ELSE 0.5
                         END *
                         0.6) +
                        (CASE
                            WHEN b.consecutive_stable_days >= 30 THEN
                                CASE WHEN r.review_action = 'APPROVED' THEN 0.60 ELSE 0.40 END
                            WHEN b.consecutive_stable_days >= 14 THEN 0.20
                            WHEN b.consecutive_stable_days >= 7 THEN 0.10
                            ELSE 0.00
                        END * 0.4)
                    ) *
                    d.confidence_penalty_applied,
                    0.00
                ),
                CASE WHEN r.review_action = 'APPROVED' THEN 0.95
                     WHEN r.review_action = 'CONDITIONAL' THEN 0.75
                     WHEN r.review_action = 'REJECTED' THEN 0.00
                     ELSE 0.50
                END
            ),
            2
        ) >= 0.30 THEN 'CAUTION'
        ELSE 'UNRELIABLE'
    END AS confidence_band,

    f.created_at AS fact_created_at,
    r.reviewed_at AS last_review_at
FROM telemetry_facts f
LEFT JOIN cognitive_enrichments e ON f.fact_id = e.fact_id
LEFT JOIN decision_drift_history d ON f.index_name = d.index_name AND d.evaluated_at = (
    SELECT MAX(evaluated_at) FROM decision_drift_history WHERE index_name = f.index_name
)
LEFT JOIN human_review_ledger r ON f.fact_id = r.fact_id AND r.reviewed_at = (
    SELECT MAX(reviewed_at) FROM human_review_ledger WHERE fact_id = f.fact_id
)
LEFT JOIN index_rolling_baselines b ON f.index_name = b.index_name;

-- ============================================================
-- MIGRATION COMPLETE: Bidirectional Confidence Ready
-- ============================================================
-- System can now recover trust as well as decay it.
-- Recovery milestones drive recovery_score accumulation.
-- Governance caps enforce approval-state boundaries.
