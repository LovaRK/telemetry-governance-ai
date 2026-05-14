import { DEFAULT_SCORING_CONFIG } from '../../core/config/weights';

export function determineRecommendation(
  value_score: number,
  waste_score: number,
  risk_score: number,
  config = DEFAULT_SCORING_CONFIG
): { action: 'KEEP' | 'OPTIMIZE' | 'ARCHIVE' | 'ELIMINATE' | 'INVESTIGATE'; priority: 'HIGH' | 'MEDIUM' | 'LOW' } {
  const { thresholds } = config;

  if (waste_score >= thresholds.eliminate_waste_min && value_score <= thresholds.eliminate_value_max) {
    return { action: 'ELIMINATE', priority: 'HIGH' };
  }

  if (value_score >= thresholds.keep_min_value) {
    return { action: 'KEEP', priority: risk_score > 50 ? 'HIGH' : 'MEDIUM' };
  }

  if (waste_score >= thresholds.optimize_waste_min) {
    return { action: 'OPTIMIZE', priority: 'HIGH' };
  }

  if (value_score < 30 && risk_score < 40) {
    return { action: 'ARCHIVE', priority: 'MEDIUM' };
  }

  return { action: 'INVESTIGATE', priority: 'LOW' };
}