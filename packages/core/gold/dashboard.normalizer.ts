/**
 * DASHBOARD NORMALIZER
 * Converts raw Splunk dashboard XML → canonical DashboardInventory
 * Applies 1/N attribution for index references
 */

import type { DashboardInventory } from './types';

interface RawDashboard {
  id: string;
  title: string;
  app: string;
  owner: string;
  xml: string;
  updated?: string;
}

interface Panel {
  title: string;
  indexReferences: string[];
  sourcetypeReferences: string[];
}

/**
 * Extract index/sourcetype references from panel XML
 */
function extractPanelReferences(panelXml: string): Panel {
  const titleMatch = panelXml.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1] : 'Unnamed';

  const indexPattern = /index\s*=\s*"?([a-zA-Z0-9_\-*]+)"?/g;
  const indexMatches = [...panelXml.matchAll(indexPattern)].map(m => m[1]);
  const indexes = [...new Set(indexMatches)].filter(idx => idx !== '*');

  const stPattern = /sourcetype\s*=\s*"?([a-zA-Z0-9_\-:]+)"?/g;
  const stMatches = [...panelXml.matchAll(stPattern)].map(m => m[1]);
  const sourcetypes = [...new Set(stMatches)];

  return {
    title,
    indexReferences: indexes,
    sourcetypeReferences: sourcetypes,
  };
}

/**
 * Extract all panels from dashboard XML
 */
function extractPanels(dashboardXml: string): Panel[] {
  const panelPattern = /<row>.*?<\/row>/gs;
  const rows = dashboardXml.match(panelPattern) || [];

  const panels: Panel[] = [];
  for (const row of rows) {
    const rowPanels = row.match(/<panel>.*?<\/panel>/gs) || [];
    for (const panelXml of rowPanels) {
      panels.push(extractPanelReferences(panelXml));
    }
  }

  return panels;
}

/**
 * CRITICAL: Attribution applied HERE
 * Dashboard references N indexes → each gets weight 1/N
 */
export function normalizeDashboards(raw: RawDashboard[]): DashboardInventory[] {
  return raw.map(dashboard => {
    const panels = extractPanels(dashboard.xml);

    // Collect all unique indexes across all panels
    const allIndexes = new Set<string>();
    const allSourcetypes = new Set<string>();

    for (const panel of panels) {
      panel.indexReferences.forEach(idx => allIndexes.add(idx));
      panel.sourcetypeReferences.forEach(st => allSourcetypes.add(st));
    }

    // 1/N ATTRIBUTION
    const totalIndexes = Math.max(allIndexes.size, 1);
    const attributionWeight = 1 / totalIndexes;

    return {
      id: dashboard.id,
      title: dashboard.title,
      app: dashboard.app,
      owner: dashboard.owner,
      panelCount: panels.length,
      lastModified: dashboard.updated ? new Date(dashboard.updated) : new Date(),
      relevantIndexes: Array.from(allIndexes),
      relevantSourcetypes: Array.from(allSourcetypes),
      _panelDetails: panels,
      _attributionWeight: attributionWeight,
    };
  });
}

/**
 * Aggregate dashboard panel counts by index with attribution
 * Used by utilization engine
 */
export function aggregatePanelCountsByIndex(
  normalized: DashboardInventory[]
): Map<string, { panelCount: number; weight: number }> {
  const counts = new Map<string, { panelCount: number; weight: number }>();

  for (const dashboard of normalized) {
    for (const idx of dashboard.relevantIndexes) {
      const current = counts.get(idx) || { panelCount: 0, weight: 0 };
      counts.set(idx, {
        panelCount: current.panelCount + dashboard.panelCount,
        weight: current.weight + dashboard._attributionWeight!,
      });
    }
  }

  return counts;
}
