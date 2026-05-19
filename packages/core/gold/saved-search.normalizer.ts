/**
 * SAVED SEARCH NORMALIZER
 * Converts raw Splunk saved searches → canonical SavedSearchInventory
 * Applies 1/N attribution at this layer (critical!)
 */

import type { SavedSearchInventory } from './types';

interface RawSavedSearch {
  id: string;
  title: string;
  author: string;
  search: string;
  updated?: string;
  is_scheduled: boolean;
  is_alert: boolean;
  dispatch_earliest_time?: string;
  dispatch_latest_time?: string;
}

function extractIndexes(searchString: string): string[] {
  const indexPattern = /index\s*=\s*"?([a-zA-Z0-9_\-*]+)"?/g;
  const matches = [...searchString.matchAll(indexPattern)].map(m => m[1]);
  return [...new Set(matches)].filter(idx => idx !== '*');
}

function extractSourcetypes(searchString: string): string[] {
  const stPattern = /sourcetype\s*=\s*"?([a-zA-Z0-9_\-:]+)"?/g;
  const matches = [...searchString.matchAll(stPattern)].map(m => m[1]);
  return [...new Set(matches)];
}

function classifySearch(search: RawSavedSearch): 'alert' | 'dashboard' | 'adhoc' {
  if (search.is_alert) return 'alert';
  if (search.is_scheduled) return 'dashboard';
  return 'adhoc';
}

/**
 * CRITICAL: Attribution is applied HERE
 * If search references N indexes → each gets weight 1/N
 * This ensures no double-counting in downstream utilization scoring
 */
export function normalizeSavedSearches(raw: RawSavedSearch[]): SavedSearchInventory[] {
  return raw.map(search => {
    const indexes = extractIndexes(search.search);
    const sourcetypes = extractSourcetypes(search.search);

    // 1/N ATTRIBUTION: Critical invariant
    const totalTargets = Math.max(indexes.length, 1);
    const attributionWeight = 1 / totalTargets;

    return {
      id: search.id,
      name: search.title,
      app: 'splunk', // default, could be extracted
      isScheduled: search.is_scheduled,
      isAlert: search.is_alert,
      schedule: search.dispatch_earliest_time,
      lastRun: search.updated ? new Date(search.updated) : undefined,
      relevantIndexes: indexes,
      relevantSourcetypes: sourcetypes,
      description: `${classifySearch(search)} - ${search.search.substring(0, 100)}`,
      _attributionWeight: attributionWeight,
      _classification: classifySearch(search),
    };
  });
}

/**
 * Aggregate search counts by index with attribution
 * Used by utilization engine
 */
export function aggregateSearchCountsByIndex(
  normalized: SavedSearchInventory[]
): Map<string, { count: number; weight: number }> {
  const counts = new Map<string, { count: number; weight: number }>();

  for (const search of normalized) {
    for (const idx of search.relevantIndexes) {
      const key = idx;
      const current = counts.get(key) || { count: 0, weight: 0 };
      counts.set(key, {
        count: current.count + 1,
        weight: current.weight + search._attributionWeight!,
      });
    }
  }

  return counts;
}
