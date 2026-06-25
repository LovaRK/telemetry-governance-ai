-- Migration 212: cost_per_gb_per_day precision (B4 tally config)
--
-- The agreed tally license cost is $183/GB/year → 0.501369…/GB/day.
-- numeric(10,2) truncated this to 0.50 ($182.50/yr), a 0.27% systematic
-- error on every annual-cost figure. Widen to 4 decimals.

ALTER TABLE user_config
  ALTER COLUMN cost_per_gb_per_day TYPE NUMERIC(10,4);
