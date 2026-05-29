'use client';

/**
 * ExecutiveOverview — refactored orchestrator (Phase 8: UI Split).
 *
 * Architecture: This is the ONLY component allowed to:
 *   - hold drawer state
 *   - call fetch() (the onApprove callback for quick wins)
 *   - perform React.useState / local session state
 *
 * All child components are pure visualization — they receive values + callbacks.
 * No child component calls fetch() directly.
 */

import React, { useState } from 'react';
import { ExecutiveSummary } from '../../../lib/types';
import ReasoningDrawer from '../../shared/ReasoningDrawer';
import KPITrendChart from '../../KPITrendChart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';

import { fmt$, fmtGB, TIER_COLORS, ACTION_COLORS, tierColor } from './utils';
import { DonutChart } from './kpi-gauges';
import { ExecutiveSummaryHeader } from './executive-summary-header';
import { TierDistribution } from './tier-distribution';
import { QuickWinsList } from './quick-wins-list';
import { ROIPanel } from './roi-panel';
import { SpendRiskMatrix } from './spend-risk-matrix';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (client-side only, non-blocking)
// ─────────────────────────────────────────────────────────────────────────────

function getActorEmail(): string {
  if (typeof window === 'undefined') return 'system';
  try {
    const ctx = JSON.parse(localStorage.getItem('auth_context') || '{}');
    if (ctx.email) return ctx.email;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.email) return user.email;
  } catch { /* ignore */ }
  return 'system';
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  summary: ExecutiveSummary;
  hasAgentDecisions?: boolean;
  explainabilityEnabled?: boolean;
}

interface DrawerState {
  isOpen: boolean;
  metric: string;
  value: string | number;
  title: string;
  howCalculated: string;
  llmReasoning?: string;
  evidence?: string[];
  confidence?: number;
  tier?: string;
  action?: string;
  candidateReason?: string[];
  rawData?: Record<string, unknown>;
  snapshotId?: string;
  runId?: string;
  computedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ExecutiveOverview({
  summary,
  hasAgentDecisions = false,
  explainabilityEnabled = false,
}: Props) {
  const {
    kpis,
    quickWins = [],
    savingsStaircase = [],
    agentReasoning = '',
    snapshotDate,
    snapshots = [],
  } = summary;

  const avgConfidencePct =
    kpis.avgConfidence <= 1 ? kpis.avgConfidence * 100 : kpis.avgConfidence;

  // ── Drawer state (single source of truth for the whole panel) ──
  const [drawer, setDrawer] = useState<DrawerState>({
    isOpen: false, metric: '', value: '', title: '', howCalculated: '',
  });

  const openDrawer = (next: DrawerState): void => {
    if (!explainabilityEnabled) return;
    setDrawer({
      ...next,
      snapshotId: next.snapshotId ?? summary.snapshotId,
      runId: next.runId ?? summary.runId,
      computedAt: next.computedAt ?? snapshotDate,
    });
  };

  // ── Derived data ──
  const tierTotal =
    kpis.tierCounts.critical + kpis.tierCounts.important +
    kpis.tierCounts.niceToHave + kpis.tierCounts.lowValue;

  const tierBars = [
    { label: 'Critical',     key: 'critical',    value: kpis.tierCounts.critical,    color: TIER_COLORS.critical    },
    { label: 'Important',    key: 'important',   value: kpis.tierCounts.important,   color: TIER_COLORS.important   },
    { label: 'Nice-to-Have', key: 'niceToHave',  value: kpis.tierCounts.niceToHave,  color: TIER_COLORS.niceToHave  },
    { label: 'Low Value',    key: 'lowValue',     value: kpis.tierCounts.lowValue,    color: TIER_COLORS.lowValue    },
  ];

  const avgUtilization = kpis.avgUtilization;
  const avgDetection   = kpis.avgDetection;
  const avgQuality     = kpis.avgQuality;

  // D4/D5: Utilized vs Under-Utilized
  const isHighValue = (tier: string) => /critical|important/i.test(tier);
  const utilizedGb         = snapshots.reduce((s, v) => s + (isHighValue(v.tier) ? v.dailyAvgGb : 0), 0);
  const underUtilizedGb    = snapshots.reduce((s, v) => s + (!isHighValue(v.tier) ? v.dailyAvgGb : 0), 0);
  const utilizedCount      = snapshots.filter(s => isHighValue(s.tier)).length;
  const underUtilizedCount = snapshots.filter(s => !isHighValue(s.tier)).length;

  // D9: Annual spend by tier
  const spendByTier = [
    { label: 'Critical',     value: snapshots.filter(s => /critical/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0), color: TIER_COLORS.critical    },
    { label: 'Important',    value: snapshots.filter(s => /important/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0), color: TIER_COLORS.important   },
    { label: 'Nice-to-Have', value: snapshots.filter(s => /nice/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0),     color: TIER_COLORS.niceToHave  },
    { label: 'Low Value',    value: snapshots.filter(s => /low.value/i.test(s.tier)).reduce((s, v) => s + v.costPerYear, 0),color: TIER_COLORS.lowValue    },
  ];
  const maxTierSpend = Math.max(...spendByTier.map(t => t.value), 1);

  // D7: Score profile by tier
  const tierGroups = [
    { label: 'Critical',     match: /critical/i  },
    { label: 'Important',    match: /important/i },
    { label: 'Nice-to-Have', match: /nice/i      },
    { label: 'Low Value',    match: /low.value/i },
  ].map(({ label, match }) => {
    const inTier = snapshots.filter(s => match.test(s.tier));
    const avg = (vals: number[]) => vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return {
      label, count: inTier.length, color: tierColor(label),
      util:    avg(inTier.map(s => s.utilizationScore)),
      detect:  avg(inTier.map(s => s.detectionScore)),
      quality: avg(inTier.map(s => s.qualityScore)),
    };
  });

  // Savings staircase (fall back to deriving from snapshots)
  const actionCounts: Record<string, number> = {};
  snapshots.forEach(s => { actionCounts[s.classification] = (actionCounts[s.classification] || 0) + 1; });

  const staircase = savingsStaircase.length > 0 ? savingsStaircase : (() => {
    const byAction: Record<string, { savings: number; count: number }> = {};
    snapshots.forEach(s => {
      if (!byAction[s.classification]) byAction[s.classification] = { savings: 0, count: 0 };
      byAction[s.classification].savings += s.estimatedSavings ?? 0;
      byAction[s.classification].count   += 1;
    });
    let cumulative = 0;
    return Object.entries(byAction)
      .filter(([, v]) => v.savings > 0)
      .sort((a, b) => b[1].savings - a[1].savings)
      .map(([action, v]) => {
        cumulative += v.savings;
        return { label: action, savings: v.savings, cumulative, action, count: v.count };
      });
  })();
  const staircaseHasDelta = staircase.some(s => s.savings > 0);

  // ── Quick-win approve callback (THE ONLY fetch call in the whole panel) ──
  const quickWinItems = quickWins.length > 0
    ? quickWins.slice(0, 5).map(qw => ({
        indexName: qw.indexName, action: qw.action,
        savings: qw.savings, tier: qw.tier, reasoning: qw.reasoning,
      }))
    : snapshots.filter(s => s.isQuickWin).slice(0, 5).map(s => ({
        indexName: s.indexName, action: s.action,
        savings: s.estimatedSavings, tier: s.tier, reasoning: s.reasoning,
      }));

  const handleApproveWin = async (qw: { indexName: string; action: string; savings: number; tier?: string }) => {
    await fetch('/api/governance/mutations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mutationType: 'APPROVE',
        indexName: qw.indexName,
        sourcetype: qw.tier ?? 'unknown',
        actorEmail: getActorEmail(),
        actionNote: `Quick-win approved: ${qw.action} — estimated savings ${fmt$(qw.savings)}`,
        idempotencyKey: `quickwin-approve-${qw.indexName}-${qw.action}-${Date.now()}`,
      }),
    });
  };

  // ── Style helpers (defined once, stable) ──
  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', ...extra,
  });
  const cardTitle: React.CSSProperties = {
    fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* D1 — Headline big numbers */}
      <ExecutiveSummaryHeader
        totalDailyGb={kpis.totalDailyGb}
        totalSourcetypes={kpis.totalSourcetypes}
        totalLicenseSpend={kpis.totalLicenseSpend}
        storageSavingsPotential={kpis.storageSavingsPotential}
        securityGaps={kpis.securityGaps}
        operationalGaps={kpis.operationalGaps}
      />

      {/* Action Required Strip — per-action counts + savings */}
      {hasAgentDecisions && snapshots.length > 0 && (() => {
        const actionSavings: Record<string, number> = {};
        for (const s of snapshots) {
          if (s.classification) {
            actionSavings[s.classification] = (actionSavings[s.classification] ?? 0) + (s.estimatedSavings ?? 0);
          }
        }
        const entries = Object.entries(actionCounts).sort((a, b) => {
          const order = ['ELIMINATE', 'ARCHIVE', 'OPTIMIZE', 'INVESTIGATE', 'KEEP'];
          return order.indexOf(a[0]) - order.indexOf(b[0]);
        });
        if (entries.length === 0) return null;
        return (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {entries.map(([action, count]) => {
              const color = ACTION_COLORS[action] || '#64748b';
              const savings = actionSavings[action] ?? 0;
              return (
                <div key={action} style={{
                  flex: 1, minWidth: 100,
                  padding: '0.75rem 1rem',
                  background: `${color}10`, border: `1px solid ${color}35`, borderRadius: 8,
                }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: '0.68rem', color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{action}</div>
                  {savings > 0 && <div style={{ fontSize: '0.65rem', color: '#22c55e', marginTop: 3 }}>~{fmt$(savings)}</div>}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Row 1 — KPI Gauges (gated by LLM decisions) */}
      {!hasAgentDecisions && (
        <div style={{
          padding: '1.25rem 1.5rem', background: '#0f1a23',
          border: '1px solid #334155', borderRadius: 12,
          color: '#94a3b8', fontSize: '0.85rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.25rem' }}>📊</span>
          <div>
            <div style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: '0.2rem' }}>Metrics pending</div>
            <div style={{ fontSize: '0.78rem' }}>
              ROI Score, GainScope Score, and detailed KPI gauges are generated by the LLM pipeline.
              Run a refresh to populate.
            </div>
          </div>
        </div>
      )}
      {hasAgentDecisions && (
        <ROIPanel
          roiScore={kpis.roiScore}
          gainScopeScore={kpis.gainScopeScore}
          licenseSpendLowValue={kpis.licenseSpendLowValue}
          storageSavingsPotential={kpis.storageSavingsPotential}
          totalLicenseSpend={kpis.totalLicenseSpend}
          totalDailyGb={kpis.totalDailyGb}
          totalSourcetypes={kpis.totalSourcetypes}
          securityGaps={kpis.securityGaps}
          operationalGaps={kpis.operationalGaps}
          tierCounts={kpis.tierCounts}
          avgUtilization={avgUtilization}
          avgDetection={avgDetection}
          avgQuality={avgQuality}
          avgConfidencePct={avgConfidencePct}
          agentReasoning={agentReasoning}
          onOpenDrawer={explainabilityEnabled ? openDrawer : undefined}
        />
      )}

      {/* Trend Charts */}
      {(() => {
        const [trendDays, setTrendDays] = React.useState<7 | 30 | 90>(7);
        return (
          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  📈 KPI Trends
                </h2>
                <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>Historical tracking across all key metrics</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {([7, 30, 90] as const).map(d => (
                  <button key={d} onClick={() => setTrendDays(d)} style={{
                    padding: '0.35rem 0.75rem', fontSize: '0.72rem', fontWeight: 700,
                    background: trendDays === d ? '#3b82f6' : '#1e293b',
                    color: trendDays === d ? '#fff' : '#64748b',
                    border: `1px solid ${trendDays === d ? '#3b82f6' : '#334155'}`,
                    borderRadius: 5, cursor: 'pointer',
                  }}>{d}d</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              {([
                { metric: 'roi'       as const, title: '🏆 ROI Score'        },
                { metric: 'gainscope' as const, title: '🎯 GainScope %'      },
                { metric: 'savings'   as const, title: '💰 Savings Potential' },
                { metric: 'ingest'    as const, title: '📦 Daily Ingest (GB)' },
              ]).map(({ metric, title }) => (
                <div key={metric} style={{ padding: '1rem 1.25rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
                    {explainabilityEnabled && (
                      <button
                        data-testid={`chart-explain-${metric}`}
                        onClick={() => openDrawer({
                          isOpen: true,
                          metric: `${metric}_trend_chart`,
                          value: 'Trend',
                          title: `${title} Trend`,
                          howCalculated: `Chart: ${title}\nX-axis: Date\nY-axis: ${title}\nFormula: derived from executive_kpis history`,
                          evidence: [
                            `Inputs: executive_kpis snapshots (${trendDays} days)`,
                            `Source origin: executive_kpis`,
                            `Confidence: ${avgConfidencePct.toFixed(0)}%`,
                            `Variance: Not computed`,
                          ],
                          confidence: avgConfidencePct,
                        })}
                        style={{ border: '1px solid #334155', background: '#0b1220', color: '#cbd5e1', borderRadius: 6, padding: '0.2rem 0.45rem', cursor: 'pointer', fontSize: '0.72rem' }}
                      >ⓘ</button>
                    )}
                  </div>
                  <KPITrendChart metric={metric} days={trendDays} height={200} showPeriodToggle={false} />
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              {([
                { metric: 'utilization' as const, title: '⚡ Avg Utilization'   },
                { metric: 'quality'     as const, title: '✅ Avg Data Quality'   },
                { metric: 'confidence'  as const, title: '🤖 Avg AI Confidence'  },
              ]).map(({ metric, title }) => (
                <div key={metric} style={{ padding: '1rem 1.25rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
                    {explainabilityEnabled && (
                      <button
                        data-testid={`chart-explain-${metric}`}
                        onClick={() => openDrawer({
                          isOpen: true,
                          metric: `${metric}_trend_chart`,
                          value: 'Trend',
                          title: `${title} Trend`,
                          howCalculated: `Chart: ${title}\nX-axis: Date\nY-axis: ${title}\nFormula: derived from executive_kpis history`,
                          evidence: [
                            `Inputs: executive_kpis snapshots (${trendDays} days)`,
                            `Source origin: executive_kpis`,
                            `Confidence: ${avgConfidencePct.toFixed(0)}%`,
                            `Variance: Not computed`,
                          ],
                          confidence: avgConfidencePct,
                        })}
                        style={{ border: '1px solid #334155', background: '#0b1220', color: '#cbd5e1', borderRadius: 6, padding: '0.2rem 0.45rem', cursor: 'pointer', fontSize: '0.72rem' }}
                      >ⓘ</button>
                    )}
                  </div>
                  <KPITrendChart metric={metric} days={trendDays} height={160} showPeriodToggle={false} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Row 2 — Tier Distribution + Score Averages + Agent Actions */}
      {!hasAgentDecisions && (
        <div style={{
          padding: '1.25rem 1.5rem', background: '#1c1008',
          border: '1px solid #f59e0b40', borderRadius: 12,
          color: '#f59e0b', fontSize: '0.85rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.25rem' }}>⏳</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>LLM decisions pending</div>
            <div style={{ color: '#b45309', fontSize: '0.78rem' }}>
              Tier classifications, risk scores, agent actions, and recommendations are hidden until
              the LLM pipeline completes. Run a Splunk refresh to generate decisions.
            </div>
          </div>
        </div>
      )}
      {hasAgentDecisions && (
        <TierDistribution
          tierBars={tierBars}
          tierTotal={tierTotal}
          snapshots={snapshots}
          avgUtilization={avgUtilization}
          avgDetection={avgDetection}
          avgQuality={avgQuality}
          avgConfidencePct={avgConfidencePct}
          snapshotDate={snapshotDate}
          agentReasoning={agentReasoning}
          onTierClick={explainabilityEnabled ? (tierKey, tierLabel, count) => {
            const tierSnaps = snapshots.filter(s =>
              new RegExp(tierLabel.toLowerCase().replace('-', '.'), 'i').test(s.tier)
            );
            const tierSpend = tierSnaps.reduce((s, v) => s + v.costPerYear, 0);
            openDrawer({
              isOpen: true,
              metric: `tier_${tierKey}`,
              value: count,
              title: `Tier: ${tierLabel}`,
              howCalculated: `Tier classification is determined by the LLM based on:\n• Utilization (how much data is actually used)\n• Detection importance (security/compliance needs)\n• Data quality and retention requirements\n• Business criticality`,
              llmReasoning: agentReasoning,
              evidence: [
                `${count} indexes classified as ${tierLabel}`,
                `Annual spend: ${fmt$(tierSpend)}`,
                `Average utilization: ${tierSnaps.length > 0 ? (tierSnaps.reduce((s, v) => s + v.utilizationScore, 0) / tierSnaps.length).toFixed(0) : 0}%`,
                `Average detection: ${tierSnaps.length > 0 ? (tierSnaps.reduce((s, v) => s + v.detectionScore, 0) / tierSnaps.length).toFixed(0) : 0}%`,
              ],
              confidence: avgConfidencePct,
              tier: tierLabel,
              rawData: { tier: tierLabel, indexCount: count, totalSpend: tierSpend },
            });
          } : undefined}
        />
      )}

      {/* Row 2.5 — D7: Score Profile by Tier */}
      {hasAgentDecisions && (
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{
            position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
            backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
            borderRadius: '12px', fontWeight: 500,
          }}>🤖 AI</div>
          <div style={cardTitle}>Score Profile by Tier</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.25rem' }}>
            {tierGroups.map(tg => (
              <div key={tg.label} style={{ borderTop: `3px solid ${tg.color}`, paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: tg.color }}>{tg.label}</span>
                  <span style={{ fontSize: '0.7rem', color: '#475569' }}>{tg.count} index{tg.count !== 1 ? 'es' : ''}</span>
                </div>
                {tg.count === 0 ? (
                  <div style={{ color: '#334155', fontSize: '0.75rem', fontStyle: 'italic' }}>No indexes</div>
                ) : (
                  <>
                    {([['Utilization', tg.util], ['Detection', tg.detect], ['Quality', tg.quality]] as [string, number][]).map(([lbl, val]) => (
                      <div key={lbl} style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b', marginBottom: '0.15rem' }}>
                          <span>{lbl}</span>
                          <span style={{ color: val >= 70 ? '#22c55e' : val >= 40 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>{val.toFixed(0)}</span>
                        </div>
                        <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(val, 100)}%`, background: tg.color, borderRadius: 3, opacity: 0.75 }} />
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 3 — D4/D5 Donuts + D9 Annual Spend by Tier */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        {/* D4: Data Volume Split */}
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{
            position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
            backgroundColor: '#27AE60', color: 'white', padding: '2px 8px',
            borderRadius: '12px', fontWeight: 500,
          }}>✓ FACT</div>
          <div style={cardTitle}>Data Volume Split</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.875rem' }}>
            <DonutChart segments={[
              { label: 'Utilized',       value: utilizedGb,      color: '#22c55e' },
              { label: 'Under-Utilized', value: underUtilizedGb, color: '#ef4444' },
            ]} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {([['Utilized', utilizedGb, '#22c55e'], ['Under-Utilized', underUtilizedGb, '#ef4444']] as [string, number, string][]).map(([lbl, val, col]) => (
              <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#94a3b8' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, display: 'inline-block' }} />{lbl}
                </span>
                <span style={{ color: col, fontWeight: 600 }}>{fmtGB(val)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* D5: Sourcetype Count Split */}
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{
            position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
            backgroundColor: '#27AE60', color: 'white', padding: '2px 8px',
            borderRadius: '12px', fontWeight: 500,
          }}>✓ FACT</div>
          <div style={cardTitle}>Sourcetype Split</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.875rem' }}>
            <DonutChart segments={[
              { label: 'Utilized',       value: utilizedCount,      color: '#22c55e' },
              { label: 'Under-Utilized', value: underUtilizedCount, color: '#ef4444' },
            ]} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {([['Utilized', utilizedCount, '#22c55e'], ['Under-Utilized', underUtilizedCount, '#ef4444']] as [string, number, string][]).map(([lbl, val, col]) => (
              <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#94a3b8' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, display: 'inline-block' }} />{lbl}
                </span>
                <span style={{ color: col, fontWeight: 600 }}>{val} indexes</span>
              </div>
            ))}
          </div>
        </div>

        {/* D9: Annual License Spend by Tier */}
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{
            position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
            backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
            borderRadius: '12px', fontWeight: 500,
          }}>🤖 AI</div>
          <div style={cardTitle}>Annual License Spend by Tier</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {spendByTier.map(tier => (
              <div key={tier.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#94a3b8' }}>{tier.label}</span>
                  <span style={{ color: tier.color, fontWeight: 600 }}>{fmt$(tier.value)}</span>
                </div>
                <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${maxTierSpend > 0 ? (tier.value / maxTierSpend) * 100 : 0}%`,
                    background: tier.color, borderRadius: 4,
                    minWidth: tier.value > 0 ? 2 : 0,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 4 — Savings Staircase + Quick Wins */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Savings Staircase */}
        <div style={{ ...card(), position: 'relative' }}>
          <div style={{
            position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
            backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
            borderRadius: '12px', fontWeight: 500,
          }}>🤖 AI</div>
          <div style={cardTitle}>Savings Staircase</div>
          {staircase.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.875rem' }}>No savings data yet</div>
          ) : !staircaseHasDelta ? (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '0.75rem' }}>
                {staircase.map((step, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.375rem 0.5rem', background: '#1e293b', borderRadius: 4 }}>
                    <span style={{ color: '#94a3b8' }}>{step.label}</span>
                    <span style={{ color: '#f8fafc', fontWeight: 600 }}>{fmt$(step.cumulative)}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic' }}>No cost reduction projected — all tiers at current spend level</div>
            </div>
          ) : (() => {
            const chartData = staircase.map((step, i) => ({
              label: step.label, action: step.action,
              savings: step.savings, cumulative: step.cumulative, index: i,
            }));
            return (
              <div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                    onClick={d => {
                      if (!d?.activePayload) return;
                      const step = d.activePayload[0]?.payload;
                      if (!step) return;
                      const count = snapshots.filter(s => s.action === step.action).length;
                      openDrawer({
                        isOpen: true,
                        metric: `${step.action.toLowerCase()}_savings`,
                        value: step.savings,
                        title: `${step.label} Savings: ${fmt$(step.savings)}`,
                        howCalculated: `${step.label} Savings = Sum of cost reduction from ${step.action.toLowerCase()} actions\n\nAction count: ${count} indexes\nPer-action avg savings: ${fmt$(step.savings / Math.max(count, 1))}\nCumulative total: ${fmt$(step.cumulative)}`,
                        llmReasoning: agentReasoning,
                        evidence: [
                          `${count} indexes classified for ${step.action.toLowerCase()}`,
                          `Estimated savings: ${fmt$(step.savings)}`,
                          `Recommendation: Prioritize by confidence and impact`,
                        ],
                        confidence: avgConfidencePct,
                        action: step.action,
                        rawData: { action: step.action, savings: step.savings, cumulative: step.cumulative, count },
                      });
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} stroke="#334155" />
                    <YAxis
                      tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                      tick={{ fill: '#64748b', fontSize: 10 }} stroke="#334155"
                    />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, fontSize: '0.75rem' }}
                      labelStyle={{ color: '#cbd5e1' }}
                      formatter={(value: number, name: string) => [
                        name === 'cumulative' ? `Cumulative: ${fmt$(value)}` : `Savings: ${fmt$(value)}`,
                        name === 'cumulative' ? 'Cumulative' : 'Phase Savings',
                      ]}
                    />
                    <Bar dataKey="savings" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={ACTION_COLORS[entry.action] || '#3b82f6'} fillOpacity={0.85} />
                      ))}
                    </Bar>
                    <Bar dataKey="cumulative" isAnimationActive={false} radius={[3, 3, 0, 0]} fillOpacity={0.25}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={ACTION_COLORS[entry.action] || '#3b82f6'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                  {chartData.map((step, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: ACTION_COLORS[step.action] || '#3b82f6' }} />
                      <span style={{ color: '#64748b' }}>{step.label}</span>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>{fmt$(step.savings)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Quick Wins — callbacks fully lifted, no fetch inside */}
        <QuickWinsList
          wins={quickWinItems}
          avgConfidencePct={avgConfidencePct}
          onApprove={handleApproveWin}
          onOpenDrawer={explainabilityEnabled ? qw => openDrawer({
            isOpen: true,
            metric: 'quick_win',
            value: qw.savings,
            title: `Quick Win: ${qw.indexName}`,
            howCalculated: `Action: ${qw.action}\nTier: ${qw.tier}\nEstimated Savings: ${fmt$(qw.savings)}\n\nFlagged as quick win by LLM: high savings, low risk.`,
            llmReasoning: qw.reasoning ?? 'No detailed reasoning provided',
            evidence: [`Index: ${qw.indexName}`, `Action: ${qw.action}`, `Tier: ${qw.tier}`, `Savings: ${fmt$(qw.savings)}`],
            confidence: avgConfidencePct,
            action: qw.action,
            tier: qw.tier,
            rawData: { indexName: qw.indexName, action: qw.action, tier: qw.tier, savings: qw.savings },
          }) : undefined}
        />
      </div>

      {/* Row 5–6 — Scatter + Volume Bars + Archive Table */}
      <SpendRiskMatrix
        snapshots={snapshots}
        avgConfidencePct={avgConfidencePct}
        agentReasoning={agentReasoning}
        onOpenDrawer={explainabilityEnabled ? openDrawer : undefined}
      />

      {/* Row 7 — Agent Reasoning (Explainability Mode only) */}
      {explainabilityEnabled && agentReasoning && (
        <div style={{ ...card({ borderLeft: '4px solid #3b82f6' }), position: 'relative' }}>
          <div style={{
            position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
            backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
            borderRadius: '12px', fontWeight: 500,
          }}>🤖 AI</div>
          <div style={cardTitle}>🧠 Agent Reasoning</div>
          <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
            {agentReasoning}
          </p>
        </div>
      )}

      {/* Reasoning Drawer (single instance for entire panel) */}
      <ReasoningDrawer
        isOpen={drawer.isOpen}
        onClose={() => setDrawer({ ...drawer, isOpen: false })}
        metric={drawer.metric}
        value={drawer.value}
        title={drawer.title}
        howCalculated={drawer.howCalculated}
        llmReasoning={explainabilityEnabled ? drawer.llmReasoning : undefined}
        evidence={explainabilityEnabled ? drawer.evidence : []}
        confidence={explainabilityEnabled ? drawer.confidence : undefined}
        tier={drawer.tier}
        action={drawer.action}
        candidateReason={explainabilityEnabled ? drawer.candidateReason : undefined}
        rawData={drawer.rawData}
        snapshotId={drawer.snapshotId}
        runId={drawer.runId}
        computedAt={drawer.computedAt}
      />
    </div>
  );
}
