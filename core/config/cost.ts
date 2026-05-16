/**
 * @deprecated This file is deprecated. Cost calculations are now done by TelemetryDecisionAgent.
 * User cost model is stored in user_config table via ConfigService.
 */

export interface CostConfig {
  cost_per_gb_per_day: number;
  retention_days: number;
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  cost_per_gb_per_day: 10,
  retention_days: 90
};

export function calculateAnnualCost(daily_gb: number, config: CostConfig): number {
  return daily_gb * config.cost_per_gb_per_day * 365;
}

export function calculateSavings(current_cost: number, recommended_action: string): number {
  switch (recommended_action) {
    case 'ELIMINATE':
      return current_cost;
    case 'ARCHIVE':
      return current_cost * 0.7;
    case 'OPTIMIZE':
      return current_cost * 0.4;
    default:
      return 0;
  }
}