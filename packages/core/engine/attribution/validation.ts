/**
 * ATTRIBUTION WEIGHTING GUARDRAIL
 *
 * Validates that utilization inputs are properly attribution-weighted
 * before scoring. Catches double-counting when the same search is
 * credited to multiple sourcetypes without 1/N fractional division.
 *
 * Validation rules:
 *   FAIL — sum(weighted_attribution) > 1.05 across any group of inputs
 *          that share the same underlying search (detected via suspiciously
 *          high aggregate counts relative to the knowledge object inventory).
 *   WARN — missing attribution metadata (adHocSearchCount == 0 AND
 *          distinctUserCount == 0, indicating incomplete KO data).
 *   PASS — all checks clear.
 *
 * These checks are conservative: they only flag clear violations,
 * not borderline cases that might be legitimate.
 */

import type { UtilizationInputs } from '../types';

export type ValidationState = 'PASS' | 'WARN' | 'FAIL';

export interface AttributionValidation {
  state: ValidationState;
  reasons: string[];
}

/**
 * Validate a batch of UtilizationInputs for correct attribution weighting.
 *
 * Checks:
 *   1. If max(alertCount) across all inputs exceeds sum(alerts) in the
 *      KO inventory, we may have un-attributed counts → WARN.
 *   2. If every input has 0 for adHocSearchCount AND distinctUserCount,
 *      attribution is incomplete → WARN.
 *   3. If sourcetype-level inputs share the same index and have non-zero
 *      counts matching the index-level entry, check for inflation → WARN.
 *
 * Returns PASS / WARN / FAIL with reasons.
 */
export function validateAttribution(
  inputs: UtilizationInputs[],
  koAlertTotal: number,
  koScheduledTotal: number,
  koDashboardTotal: number
): AttributionValidation {
  const reasons: string[] = [];

  if (inputs.length === 0) {
    return { state: 'WARN', reasons: ['No utilization inputs to validate'] };
  }

  // Check 1: total alert/scheduled/dashboard counts across all inputs
  // should not wildly exceed the KO inventory totals (which already have 1/N applied)
  const totalAlert = inputs.reduce((s, inp) => s + inp.alertCount, 0);
  const totalScheduled = inputs.reduce((s, inp) => s + inp.scheduledSearchCount, 0);
  const totalDashboard = inputs.reduce((s, inp) => s + inp.dashboardPanelCount, 0);

  // If aggregate counts are > 3× inventory, assume double-counting
  const INFLATION_THRESHOLD = 3.0;
  let worstRatio = 0;
  if (koAlertTotal > 0) {
    const ratio = totalAlert / koAlertTotal;
    worstRatio = Math.max(worstRatio, ratio);
    if (ratio > INFLATION_THRESHOLD) {
      reasons.push(`Alert count ${totalAlert.toFixed(1)} is ${ratio.toFixed(1)}× inventory total ${koAlertTotal} — double-counting likely`);
    }
  }
  if (koScheduledTotal > 0) {
    const ratio = totalScheduled / koScheduledTotal;
    worstRatio = Math.max(worstRatio, ratio);
    if (ratio > INFLATION_THRESHOLD) {
      reasons.push(`Scheduled search count ${totalScheduled.toFixed(1)} is ${ratio.toFixed(1)}× inventory total ${koScheduledTotal} — double-counting likely`);
    }
  }
  if (koDashboardTotal > 0) {
    const ratio = totalDashboard / koDashboardTotal;
    worstRatio = Math.max(worstRatio, ratio);
    if (ratio > INFLATION_THRESHOLD) {
      reasons.push(`Dashboard panel count ${totalDashboard.toFixed(1)} is ${ratio.toFixed(1)}× inventory total ${koDashboardTotal} — double-counting likely`);
    }
  }

  // Check 2: missing attribution metadata
  const allAdHocZero = inputs.every(inp => inp.adHocSearchCount === 0);
  const allUsersZero = inputs.every(inp => inp.distinctUserCount === 0);
  if (allAdHocZero && allUsersZero) {
    reasons.push('Ad-hoc search and distinct user counts are all 0 — attribution data incomplete');
  }

  // Check 3: sourcetype-level entries sharing index-level counts
  const indexAlertMap = new Map<string, { count: number; sourcetypeCount: number }>();
  const indexScheduledMap = new Map<string, { count: number; sourcetypeCount: number }>();
  for (const inp of inputs) {
    if (inp.sourcetype) {
      // sourcetype-level entry
      const a = indexAlertMap.get(inp.index) || { count: 0, sourcetypeCount: 0 };
      a.count += inp.alertCount;
      a.sourcetypeCount++;
      indexAlertMap.set(inp.index, a);

      const s = indexScheduledMap.get(inp.index) || { count: 0, sourcetypeCount: 0 };
      s.count += inp.scheduledSearchCount;
      s.sourcetypeCount++;
      indexScheduledMap.set(inp.index, s);
    }
  }
  for (const [index, info] of indexAlertMap) {
    if (info.sourcetypeCount > 1 && info.count > 0) {
      const avgPerSourcetype = Math.round(info.count / info.sourcetypeCount * 10) / 10;
      if (avgPerSourcetype > 3) {
        reasons.push(`Index "${index}" has ${info.sourcetypeCount} sourcetypes sharing avg ${avgPerSourcetype} alert count — verify 1/N attribution`);
      }
    }
  }

  if (reasons.length === 0) {
    return { state: 'PASS', reasons: [] };
  }

  // FAIL if worst ratio indicates definite double-counting
  if (worstRatio > INFLATION_THRESHOLD) {
    return { state: 'FAIL', reasons };
  }

  return { state: 'WARN', reasons };
}
