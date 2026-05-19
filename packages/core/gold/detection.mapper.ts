/**
 * DETECTION COVERAGE MAPPER
 * Normalizes MITRE ATT&CK + Lantern use case coverage per sourcetype
 * No computation — pure schema normalization
 */

import type { DetectionCoverage } from './types';

interface RawMitreMapping {
  sourcetype: string;
  techniques: string[];
  activeAlerts: number;
}

interface RawLanternMapping {
  sourcetype: string;
  usecases: string[];
}

/**
 * Normalize MITRE technique coverage
 */
export function mapMitreCoverage(raw: RawMitreMapping[]): DetectionCoverage[] {
  return raw.map(item => {
    const maxTechniques = 50; // Approximate max MITRE techniques per sourcetype
    const maxAlerts = Math.max(...raw.map(r => r.activeAlerts), 1);

    return {
      index: item.sourcetype,
      sourcetype: item.sourcetype,
      mitreTechniques: item.techniques,
      lanternUsecases: [],
      activeAlerts: item.activeAlerts,
      coveragePercentage: (item.techniques.length / maxTechniques) * 100,
      _sourceType: 'mitre',
    };
  });
}

/**
 * Normalize Lantern use case coverage
 */
export function mapLanternCoverage(raw: RawLanternMapping[]): DetectionCoverage[] {
  return raw.map(item => ({
    index: item.sourcetype,
    sourcetype: item.sourcetype,
    mitreTechniques: [],
    lanternUsecases: item.usecases,
    activeAlerts: 0,
    coveragePercentage: (item.usecases.length / 10) * 100, // ~10 major use case categories
    _sourceType: 'lantern',
  }));
}

/**
 * CRITICAL: Merge MITRE + Lantern into single canonical model
 * Ensures no double-counting in detection scoring
 */
export function mergeDetectionCoverage(
  mitreCoverage: DetectionCoverage[],
  lanternCoverage: DetectionCoverage[]
): Map<string, DetectionCoverage> {
  const merged = new Map<string, DetectionCoverage>();

  // Load MITRE first
  for (const coverage of mitreCoverage) {
    merged.set(coverage.sourcetype || '', coverage);
  }

  // Merge Lantern (don't overwrite)
  for (const coverage of lanternCoverage) {
    const key = coverage.sourcetype || '';
    const existing = merged.get(key);

    if (existing) {
      merged.set(key, {
        ...existing,
        lanternUsecases: coverage.lanternUsecases,
        coveragePercentage: Math.max(existing.coveragePercentage, coverage.coveragePercentage),
      });
    } else {
      merged.set(key, coverage);
    }
  }

  return merged;
}

/**
 * Calculate detection gap signals
 * For use by deterministic engine
 */
export function calculateDetectionGaps(coverage: DetectionCoverage[]): Map<string, boolean> {
  const gaps = new Map<string, boolean>();

  for (const item of coverage) {
    const key = item.sourcetype || '';
    // Gap: has significant MITRE coverage but thin alert coverage
    const hasGap =
      item.mitreTechniques.length >= 15 && item.activeAlerts < Math.max(item.mitreTechniques.length * 0.25, 1);

    gaps.set(key, hasGap);
  }

  return gaps;
}
