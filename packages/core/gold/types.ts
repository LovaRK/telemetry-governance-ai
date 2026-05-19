/**
 * GOLD LAYER - Semantic Normalization Types
 * Stable, normalized structures for all Splunk-sourced data
 * Single source of truth for downstream systems
 */

export interface SavedSearchInventory {
  id: string;
  name: string;
  app: string;
  isScheduled: boolean;
  isAlert: boolean;
  schedule?: string;
  lastRun?: Date;
  relevantIndexes: string[];
  relevantSourcetypes: string[];
  description?: string;
}

export interface DashboardInventory {
  id: string;
  title: string;
  app: string;
  owner: string;
  panelCount: number;
  lastModified: Date;
  relevantIndexes: string[];
  relevantSourcetypes: string[];
}

export interface DetectionCoverage {
  index: string;
  sourcetype?: string;
  mitreTechniques: string[];
  lanternUsecases: string[];
  activeAlerts: number;
  coveragePercentage: number;
}

export interface QualitySignals {
  index: string;
  sourcetype?: string;
  parseErrorRate: number;
  weightedIssues: number;
  qualityScore: number;
  lastAssessment: Date;
}

export interface TelemetrySnapshot {
  snapshotId: string;
  snapshotDate: Date;
  index: string;
  sourcetype?: string;
  dailyAvgGb: number;
  totalEvents: number;
  retentionDays: number;
  firstEvent?: Date;
  lastEvent?: Date;
  costPerGbPerDay: number;
  annualCostUsd: number;
}
