-- ============================================
-- Migration 205: Tier Spend Aggregation & Reconciliation
-- Date: 2026-06-03
-- Description: Add tier-level spend aggregation, per-tier counts, and reconciliation metadata
-- ============================================

-- Add tier spend columns (annual spend per tier)
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_1_spend_annual DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_2_spend_annual DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_3_spend_annual DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_4_spend_annual DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Add per-tier counts (how many sourcetypes per tier)
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_1_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_2_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_3_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_4_count INTEGER NOT NULL DEFAULT 0;

-- Add reconciliation metadata
-- tier_spend_reconciled: was the snapshot valid (tier sum ≈ total spend)?
-- tier_spend_delta: abs((tier1+tier2+tier3+tier4) - total_license_spend) for audit
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_spend_reconciled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tier_spend_delta DECIMAL(18,2) NOT NULL DEFAULT 0.00;

-- Create index on reconciliation status for audit queries
CREATE INDEX IF NOT EXISTS idx_exec_kpis_reconciled ON executive_kpis(tier_spend_reconciled, snapshot_date DESC);

-- Create index on tier spends for cost analysis queries
CREATE INDEX IF NOT EXISTS idx_exec_kpis_tier_spends ON executive_kpis(tier_1_spend_annual DESC, tier_2_spend_annual DESC, tier_3_spend_annual DESC, tier_4_spend_annual DESC);

-- Add comment for documentation
COMMENT ON COLUMN executive_kpis.tier_1_spend_annual IS 'Annual spend for Tier 1 (Critical) sourcetypes - aggregated from agent_decisions';
COMMENT ON COLUMN executive_kpis.tier_2_spend_annual IS 'Annual spend for Tier 2 (Important) sourcetypes - aggregated from agent_decisions';
COMMENT ON COLUMN executive_kpis.tier_3_spend_annual IS 'Annual spend for Tier 3 (Nice-to-Have) sourcetypes - aggregated from agent_decisions';
COMMENT ON COLUMN executive_kpis.tier_4_spend_annual IS 'Annual spend for Tier 4 (Low-Value) sourcetypes - aggregated from agent_decisions';
COMMENT ON COLUMN executive_kpis.tier_1_count IS 'Count of sourcetypes in Tier 1 (Critical)';
COMMENT ON COLUMN executive_kpis.tier_2_count IS 'Count of sourcetypes in Tier 2 (Important)';
COMMENT ON COLUMN executive_kpis.tier_3_count IS 'Count of sourcetypes in Tier 3 (Nice-to-Have)';
COMMENT ON COLUMN executive_kpis.tier_4_count IS 'Count of sourcetypes in Tier 4 (Low-Value)';
COMMENT ON COLUMN executive_kpis.tier_spend_reconciled IS 'Reconciliation status: true if tier sum ≈ total_license_spend (delta ≤ 0.01)';
COMMENT ON COLUMN executive_kpis.tier_spend_delta IS 'Reconciliation delta: abs((tier_1+tier_2+tier_3+tier_4) - total_license_spend) for audit trail';
