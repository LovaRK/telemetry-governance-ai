/**
 * GOLD LAYER — Semantic Normalization Engine
 * Single source of truth for all normalized Splunk data
 * Enforces: canonical schema, deduplication, 1/N attribution, identity resolution
 */

export {
  normalizeSavedSearches,
  aggregateSearchCountsByIndex,
  type SavedSearchInventory,
} from './saved-search.normalizer';

export {
  normalizeDashboards,
  aggregatePanelCountsByIndex,
  type DashboardInventory,
} from './dashboard.normalizer';

export {
  mapMitreCoverage,
  mapLanternCoverage,
  mergeDetectionCoverage,
  calculateDetectionGaps,
  type DetectionCoverage,
} from './detection.mapper';

export {
  mapQualitySignals,
  aggregateQualityMetrics,
  identifyQualityHotspots,
  type QualitySignals,
} from './quality.mapper';

export {
  buildTelemetrySnapshot,
  buildTelemetrySnapshots,
  calculatePortfolioMetrics,
  identifyHighCostIndexes,
  identifyStaleIndexes,
  type TelemetrySnapshot,
} from './telemetry.builder';

export type {
  SavedSearchInventory,
  DashboardInventory,
  DetectionCoverage,
  QualitySignals,
  TelemetrySnapshot,
} from './types';
