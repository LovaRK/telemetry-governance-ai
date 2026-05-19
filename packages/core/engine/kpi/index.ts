/**
 * PORTFOLIO-LEVEL KPI ENGINE
 * High-level metrics computed from scored sourcetypes
 */

import type { ScoredSourcetype } from '../types';

export interface PortfolioKPIs {
  roiScore: number;
  gainScope: number;
  lowValueSpend: number;
  securityGaps: number;
  operationalGaps: number;
}

export function computeROIScore(scored: ScoredSourcetype[]): number {
  if (scored.length === 0) return 0;
  const avg = scored.reduce((sum, s) => sum + s.compositeScore, 0) / scored.length;
  return Math.round(avg * 10) / 10;
}

export function computeGainScope(scored: ScoredSourcetype[]): number {
  const totalGb = scored.reduce((sum, s) => sum + s.dailyGb, 0);
  if (totalGb === 0) return 0;
  const tier12Gb = scored
    .filter(s => s.tier === 'Critical' || s.tier === 'Important')
    .reduce((sum, s) => sum + s.dailyGb, 0);
  return Math.round((tier12Gb / totalGb) * 100 * 10) / 10;
}

export function computeLowValueSpend(scored: ScoredSourcetype[]): number {
  return scored
    .filter(s => s.tier === 'Nice-to-Have' || s.tier === 'Low-Value')
    .reduce((sum, s) => sum + s.annualCostUsd, 0);
}

export function computePortfolioKPIs(scored: ScoredSourcetype[]): PortfolioKPIs {
  const securityGaps = scored.filter(s => s.detectionGap).length;
  const operationalGaps = scored.filter(s => s.operationalGap).length;

  return {
    roiScore: computeROIScore(scored),
    gainScope: computeGainScope(scored),
    lowValueSpend: computeLowValueSpend(scored),
    securityGaps,
    operationalGaps,
  };
}
