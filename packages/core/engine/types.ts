/**
 * DETERMINISTIC ENGINE - Core Types
 * Pure TypeScript interfaces (no dependencies)
 */

export interface UtilizationInputs {
  index: string;
  sourcetype?: string | null;
  alertCount: number;
  scheduledSearchCount: number;
  dashboardPanelCount: number;
  distinctUserCount: number;
  adHocSearchCount: number;
}

export interface DetectionInputs {
  index: string;
  sourcetype?: string | null;
  mitreTechniqueCount: number;
  lanternUsecaseCount: number;
  activeAlertCount: number;
}

export interface QualityInputs {
  index: string;
  sourcetype?: string | null;
  weightedIssues: number;
  dailyGb: number;
  eventsPerGbFactor?: number;
}

export interface ScoringWeights {
  utilization: number;
  detection: number;
  quality: number;
}

export type TierLabel = 'Critical' | 'Important' | 'Nice-to-Have' | 'Low-Value';

export interface ScoredSourcetype {
  index: string;
  sourcetype?: string | null;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  compositeScore: number;
  tier: TierLabel;
  dailyGb: number;
  annualCostUsd: number;
  detectionGap: boolean;
  operationalGap: boolean;
}

export interface DetectionScoreResult {
  score: number;
  detectionGap: boolean;
  operationalGap: boolean;
}
