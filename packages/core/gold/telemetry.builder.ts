/**
 * TELEMETRY SNAPSHOT BUILDER
 * Normalizes index metadata → canonical TelemetrySnapshot
 * Single source of truth for all volume/cost/retention data
 */

import type { TelemetrySnapshot } from './types';

interface RawIndexMetrics {
  index: string;
  sourcetype?: string;
  dailyAvgGb: number;
  totalEvents: number;
  retentionDays: number;
  firstEvent?: string;
  lastEvent?: string;
}

interface RawSourcetypeMetrics extends RawIndexMetrics {
  sourcetype: string;
}

/**
 * Build canonical telemetry snapshot from raw metrics
 */
export function buildTelemetrySnapshot(raw: RawIndexMetrics, snapshotId: string, snapshotDate: Date, costPerGbPerDay: number): TelemetrySnapshot {
  const dailyGb = Math.max(raw.dailyAvgGb, 0);
  const annualCostUsd = dailyGb * 365 * costPerGbPerDay;

  return {
    snapshotId,
    snapshotDate,
    index: raw.index,
    sourcetype: raw.sourcetype,
    dailyAvgGb: dailyGb,
    totalEvents: Math.max(raw.totalEvents, 0),
    retentionDays: Math.max(raw.retentionDays, 0),
    firstEvent: raw.firstEvent ? new Date(raw.firstEvent) : undefined,
    lastEvent: raw.lastEvent ? new Date(raw.lastEvent) : undefined,
    costPerGbPerDay,
    annualCostUsd,
    _isActive: raw.lastEvent ? new Date(raw.lastEvent).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000 : false, // within 30 days
    _daysOfHistory: calculateDaysOfHistory(raw),
  };
}

/**
 * Build multiple snapshots from batch of metrics
 */
export function buildTelemetrySnapshots(
  raw: RawIndexMetrics[],
  snapshotId: string,
  snapshotDate: Date,
  costPerGbPerDay: number
): TelemetrySnapshot[] {
  return raw.map(metrics => buildTelemetrySnapshot(metrics, snapshotId, snapshotDate, costPerGbPerDay));
}

/**
 * Calculate effective days of history from first/last event
 */
function calculateDaysOfHistory(raw: RawIndexMetrics): number {
  if (!raw.firstEvent || !raw.lastEvent) return raw.retentionDays;

  const first = new Date(raw.firstEvent).getTime();
  const last = new Date(raw.lastEvent).getTime();
  const days = (last - first) / (24 * 60 * 60 * 1000);

  return Math.min(Math.max(days, 0), raw.retentionDays);
}

/**
 * Calculate portfolio metrics from snapshots
 */
export function calculatePortfolioMetrics(snapshots: TelemetrySnapshot[]): {
  totalDailyGb: number;
  totalAnnualCostUsd: number;
  avgRetentionDays: number;
  activeIndexCount: number;
  totalEventsAcrossPortfolio: number;
} {
  const totalDailyGb = snapshots.reduce((sum, s) => sum + s.dailyAvgGb, 0);
  const totalAnnualCostUsd = snapshots.reduce((sum, s) => sum + s.annualCostUsd, 0);
  const avgRetentionDays = snapshots.length > 0 ? snapshots.reduce((sum, s) => sum + s.retentionDays, 0) / snapshots.length : 0;
  const activeIndexCount = snapshots.filter(s => s._isActive).length;
  const totalEventsAcrossPortfolio = snapshots.reduce((sum, s) => sum + s.totalEvents, 0);

  return {
    totalDailyGb,
    totalAnnualCostUsd,
    avgRetentionDays,
    activeIndexCount,
    totalEventsAcrossPortfolio,
  };
}

/**
 * Identify high-cost indexes for prioritization
 */
export function identifyHighCostIndexes(snapshots: TelemetrySnapshot[], topN: number = 20): TelemetrySnapshot[] {
  return snapshots.sort((a, b) => b.annualCostUsd - a.annualCostUsd).slice(0, topN);
}

/**
 * Identify stale indexes (no recent activity)
 */
export function identifyStaleIndexes(snapshots: TelemetrySnapshot[], daysSinceLastEvent: number = 30): TelemetrySnapshot[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysSinceLastEvent);

  return snapshots.filter(s => s.lastEvent && s.lastEvent < cutoffDate);
}
